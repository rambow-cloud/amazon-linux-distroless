#define _GNU_SOURCE
#include <grp.h>
#include <locale.h>
#include <netdb.h>
#include <pwd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/statvfs.h>
#include <time.h>
#include <unistd.h>

static void require(int ok, const char *message) {
    if (!ok) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static void terminate(int sig) {
    (void)sig;
    _exit(42);
}

int main(int argc, char **argv) {
    require(argc == 2, "expected a probe mode");
    if (strcmp(argv[1], "exit") == 0)
        return 37;
    if (strcmp(argv[1], "signal") == 0) {
        struct sigaction action = { .sa_handler = terminate };
        sigemptyset(&action.sa_mask);
        require(sigaction(SIGTERM, &action, NULL) == 0, "install SIGTERM handler");
        puts("READY");
        fflush(stdout);
        for (;;)
            pause();
    }
    require(strcmp(argv[1], "check") == 0, "unknown probe mode");
    require(getuid() == 65532 && getgid() == 65532, "numeric identity");
    const struct passwd *pw = getpwuid(getuid());
    require(pw && strcmp(pw->pw_name, "nonroot") == 0, "passwd NSS");
    const struct group *gr = getgrgid(getgid());
    require(gr && strcmp(gr->gr_name, "nonroot") == 0, "group NSS");
    require(setlocale(LC_ALL, "") && MB_CUR_MAX > 1, "C.UTF-8");
    const time_t timestamp = 1700000000;
    const struct tm *clock = localtime(&timestamp);
    require(clock && clock->tm_gmtoff == 0 && strcmp(clock->tm_zone, "UTC") == 0, "UTC");
    struct statvfs mount;
    require(statvfs("/", &mount) == 0 && (mount.f_flag & ST_RDONLY), "read-only root");
    require(prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) == 1, "no new privileges");
    char temporary[] = "/tmp/foundation-XXXXXX";
    int fd = mkstemp(temporary);
    require(fd >= 0 && write(fd, "ok", 2) == 2 && close(fd) == 0 && unlink(temporary) == 0, "writable temporary mount");
    struct addrinfo *resolved;
    require(getaddrinfo("fixture.test", NULL, NULL, &resolved) == 0, "glibc DNS");
    freeaddrinfo(resolved);
    const char *bundle = getenv("SSL_CERT_FILE");
    FILE *ca = bundle ? fopen(bundle, "r") : NULL;
    require(ca != NULL, "AL2023 CA path");
    char line[256];
    int found = 0;
    while (fgets(line, sizeof line, ca))
        if (strstr(line, "-----BEGIN CERTIFICATE-----")) {
            found = 1;
            break;
        }
    fclose(ca);
    require(found, "CA PEM content");
    puts("PASS: AL2023 C loader, UID/GID, NSS, locale, UTC, CA and hardened filesystem");
    return 0;
}
