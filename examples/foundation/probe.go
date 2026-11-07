package main

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"os/user"
	"strings"
	"syscall"
	"time"
)

func require(ok bool, message string) {
	if !ok {
		panic(message)
	}
}

func check() {
	u, err := user.Current()
	require(err == nil && u.Uid == "65532" && u.Username == "nonroot" &&
		os.Getuid() == 65532 && os.Getgid() == 65532, "UID/GID and passwd")
	g, err := user.LookupGroupId("65532")
	require(err == nil && g.Name == "nonroot", "group lookup")
	dir, err := os.Getwd()
	require(err == nil && dir == "/app", "working directory")
	var fs syscall.Statfs_t
	require(syscall.Statfs("/", &fs) == nil && fs.Flags&1 != 0, "root is read-only")
	status, err := os.ReadFile("/proc/self/status")
	require(err == nil && strings.Contains(string(status), "NoNewPrivs:\t1\n") &&
		strings.Contains(string(status), "CapEff:\t0000000000000000\n"), "process hardening")
	tmp, err := os.CreateTemp("/tmp", "foundation")
	require(err == nil, "writable temporary mount")
	require(tmp.Close() == nil && os.Remove(tmp.Name()) == nil, "temporary file cleanup")
	zone, offset := time.Now().Zone()
	require(zone == "UTC" && offset == 0, "UTC")
	addrs, err := net.LookupHost("fixture.test")
	require(err == nil && len(addrs) > 0, "container DNS")
	pool, err := x509.SystemCertPool()
	require(err == nil && len(pool.Subjects()) > 0, "AL2023 CA trust")

	client := &http.Client{Timeout: 4 * time.Second}
	_, err = client.Get("https://fixture.test:8443")
	var unknown x509.UnknownAuthorityError
	require(errors.As(err, &unknown), fmt.Sprintf("untrusted CA accepted or unexpected error: %v", err))
	cert, err := os.ReadFile("/fixture/cert.pem")
	require(err == nil && pool.AppendCertsFromPEM(cert), "load fixture CA as application input")
	client.Transport = &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}
	resp, err := client.Get("https://fixture.test:8443")
	require(err == nil, fmt.Sprintf("controlled TLS request: %v", err))
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	require(err == nil && resp.StatusCode == 200 && string(body) == "foundation\n", "TLS response")
	_, err = client.Get("https://other.test:8443")
	var hostname x509.HostnameError
	require(errors.As(err, &hostname), fmt.Sprintf("hostname mismatch accepted or unexpected error: %v", err))
	fmt.Println("PASS: identity, UTC, hardening, DNS and TLS")
}

func main() {
	require(len(os.Args) == 2, "expected a probe mode")
	switch os.Args[1] {
	case "check":
		check()
	case "serve":
		listener, err := net.Listen("tcp", ":8443")
		require(err == nil, "fixture socket")
		server := &http.Server{
			Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprintln(w, "foundation") }),
			ReadHeaderTimeout: 3 * time.Second,
		}
		fmt.Println("READY")
		panic(server.ServeTLS(listener, "/fixture/cert.pem", "/fixture/key.pem"))
	case "signal":
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, syscall.SIGTERM)
		fmt.Println("READY")
		<-signals
		os.Exit(42)
	case "exit":
		os.Exit(37)
	default:
		panic("unknown probe mode")
	}
}
