import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.Arrays;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

public final class Hello {
    public static void main(String[] args) throws Exception {
        if (args.length == 1 && args[0].equals("--exit-17")) System.exit(17);
        String status = Files.readString(Path.of("/proc/self/status"));
        String uid = status.lines().filter(line -> line.startsWith("Uid:"))
                .findFirst().orElseThrow().split("\\s+")[1];
        if (!uid.equals("65532")) throw new IllegalStateException("Unexpected UID: " + uid);
        if (!System.getProperty("user.name").equals("nonroot"))
            throw new IllegalStateException("passwd lookup failed");
        if (!ZoneId.systemDefault().getId().equals("UTC"))
            throw new IllegalStateException("Expected UTC");
        TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trust.init((java.security.KeyStore) null);
        int issuers = Arrays.stream(trust.getTrustManagers())
                .filter(t -> t instanceof X509TrustManager)
                .mapToInt(t -> ((X509TrustManager) t).getAcceptedIssuers().length).sum();
        if (issuers == 0) throw new IllegalStateException("No JVM trust anchors");
        Path probe = Files.createTempFile("al2023-distroless-", ".txt");
        Files.writeString(probe, "writable tmpfs");
        Files.delete(probe);
        boolean readOnly = Files.getFileStore(Path.of("/")).isReadOnly();
        if (!readOnly) throw new IllegalStateException("Root mount is writable");
        try {
            Files.writeString(Path.of("/app/should-not-exist"), "forbidden");
        } catch (java.nio.file.FileSystemException expected) {
            readOnly = true;
        }
        if (!readOnly) throw new IllegalStateException("Root filesystem is writable");
        System.out.printf(
            "{\"message\":\"Hello from AL2023 distroless Java\",\"java\":\"%s\",\"uid\":%s,\"user\":\"nonroot\",\"timezone\":\"UTC\",\"trustAnchors\":%d,\"readOnlyRootfs\":true,\"tmpfs\":true}%n",
            System.getProperty("java.version"), uid, issuers);
    }
}
