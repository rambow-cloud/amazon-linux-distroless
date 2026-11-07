import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.GraphicsEnvironment;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import javax.imageio.ImageIO;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import javax.tools.ToolProvider;

public final class Probe {
    public static void premain(String arguments, java.lang.instrument.Instrumentation instrumentation) {
        System.setProperty("al2023.agent", "loaded");
    }
    private static void require(boolean ok, String message) {
        if (!ok) throw new IllegalStateException(message);
    }
    private static SSLContext trust(boolean certificate) throws Exception {
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType()); store.load(null, null);
        if (certificate) try (var in = Files.newInputStream(Path.of("/fixture/server.pem"))) {
            store.setCertificateEntry("fixture", CertificateFactory.getInstance("X.509").generateCertificate(in));
        }
        TrustManagerFactory managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        managers.init(store);
        SSLContext context = SSLContext.getInstance("TLS"); context.init(null, managers.getTrustManagers(), null); return context;
    }
    private static void request(String host, boolean trusted, boolean reject) throws Exception {
        InetAddress address = InetAddress.getByName(host);
        HttpClient client = HttpClient.newBuilder().sslContext(trust(trusted)).connectTimeout(java.time.Duration.ofSeconds(5)).build();
        try {
            var response = client.send(HttpRequest.newBuilder(URI.create("https://" + host + ":8443/ping")).GET().build(), HttpResponse.BodyHandlers.ofString());
            require(!reject && response.statusCode() == 200 && response.body().equals("java-runtime-ok"), "Unexpected TLS response");
        } catch (Exception exception) {
            boolean tls = false;
            for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
                if (cause instanceof SSLHandshakeException || cause instanceof java.security.cert.CertificateException ||
                    cause instanceof java.security.InvalidAlgorithmParameterException) tls = true;
            }
            if (!reject || !tls) throw exception;
        }
        System.out.println("{\"host\":\"" + host + "\",\"address\":\"" + address.getHostAddress() + "\",\"tlsRejected\":" + reject + "}");
    }
    private static void serve() throws Exception {
        KeyStore key = KeyStore.getInstance("PKCS12");
        try (var in = Files.newInputStream(Path.of("/fixture/server.p12"))) { key.load(in, "test-only-password".toCharArray()); }
        KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        managers.init(key, "test-only-password".toCharArray());
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(managers.getKeyManagers(), null, null);
        HttpsServer server = HttpsServer.create(new InetSocketAddress(8443), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(tls));
        server.createContext("/ping", exchange -> {
            byte[] bytes = "java-runtime-ok".getBytes(StandardCharsets.UTF_8); exchange.sendResponseHeaders(200, bytes.length);
            try (var stream = exchange.getResponseBody()) { stream.write(bytes); }
        });
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { server.stop(0); System.out.println("shutdown-hook-ran"); }));
        server.start(); System.out.println("READY"); new CountDownLatch(1).await();
    }
    public static void main(String[] args) throws Exception {
        String mode = args.length == 0 ? "check" : args[0];
        if (mode.equals("exit")) System.exit(17);
        if (mode.equals("serve")) { serve(); return; }
        if (mode.equals("tls")) { request(args[1], true, false); return; }
        if (mode.equals("untrusted")) { request("tls-fixture", false, true); return; }
        if (mode.equals("hostname")) { request("wrong-name", true, true); return; }
        if (mode.equals("agent")) require(System.getProperty("al2023.agent", "").equals("loaded"), "Java agent failed");
        int expectedMajor = Integer.parseInt(System.getProperty("al2023.expectedMajor"));
        require(Runtime.version().feature() == expectedMajor, "Wrong Java major");
        String uid = Files.readString(Path.of("/proc/self/status")).lines().filter(s -> s.startsWith("Uid:")).findFirst().orElseThrow().split("\\s+")[1];
        require(uid.equals("65532") && System.getProperty("user.name").equals("nonroot"), "Wrong user");
        require(ProcessHandle.current().pid() == 1, "Java must be PID 1");
        require(Files.isSameFile(Path.of(System.getenv("JAVA_HOME")), Path.of(System.getProperty("java.home"))), "JAVA_HOME mismatch");
        require(ZoneId.systemDefault().getId().equals("UTC"), "Wrong timezone");
        require(StandardCharsets.UTF_8.equals(java.nio.charset.Charset.defaultCharset()), "Expected UTF-8");
        require(Files.getFileStore(Path.of("/")).isReadOnly(), "Root is writable");
        Path temporary = Files.createTempFile("java-runtime-", ".txt"); Files.writeString(temporary, "temporary"); Files.delete(temporary);
        Path unicode = Files.createTempFile("\u00e9-\u6d4b\u8bd5-", ".txt");
        Files.writeString(unicode, "\u00e9-\u6d4b\u8bd5");
        require(Files.readString(unicode).equals("\u00e9-\u6d4b\u8bd5"), "Unicode filename/content round trip failed");
        Files.delete(unicode);
        require(ToolProvider.getSystemJavaCompiler() == null, "Compiler implementation is present");
        List<String> forbidden = List.of("jdk.compiler", "jdk.jlink", "jdk.javadoc", "jdk.jdeps", "jdk.jartool", "jdk.jdi", "jdk.jconsole", "jdk.jcmd");
        for (String module : forbidden) require(ModuleLayer.boot().findModule(module).isEmpty(), "Tool module present: " + module);
        TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); trust.init((KeyStore)null);
        int roots = Arrays.stream(trust.getTrustManagers()).filter(t -> t instanceof X509TrustManager)
            .mapToInt(t -> ((X509TrustManager)t).getAcceptedIssuers().length).sum();
        require(roots >= 100, "Missing AL2023 JVM trust anchors");
        require(GraphicsEnvironment.isHeadless(), "Expected headless runtime");
        int fonts = GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames().length;
        BufferedImage image = new BufferedImage(180, 60, BufferedImage.TYPE_INT_RGB); Graphics2D graphics = image.createGraphics();
        graphics.setColor(Color.WHITE); graphics.fillRect(0, 0, 180, 60); graphics.setColor(Color.BLACK);
        graphics.setFont(new Font("SansSerif", Font.PLAIN, 18)); graphics.drawString("Java AL2023", 5, 30); graphics.dispose();
        boolean ink = false; for (int y = 0; y < image.getHeight(); y++) for (int x = 0; x < image.getWidth(); x++) if (image.getRGB(x,y) != Color.WHITE.getRGB()) ink = true;
        require(fonts > 0 && ink, "Font rendering failed");
        var bytes = new java.io.ByteArrayOutputStream(); require(ImageIO.write(image, "png", bytes), "PNG encoding unavailable");
        require(ImageIO.read(new ByteArrayInputStream(bytes.toByteArray())).getWidth() == 180, "PNG decode failed");
        System.out.printf("{\"java\":\"%s\",\"arch\":\"%s\",\"uid\":65532,\"pid\":1,\"trustAnchors\":%d,\"fontFamilies\":%d,\"pngBytes\":%d,\"compilerAbsent\":true,\"readOnlyRootfs\":true,\"timezone\":\"UTC\"}%n",
            System.getProperty("java.version"), System.getProperty("os.arch"), roots, fonts, bytes.size());
    }
}
