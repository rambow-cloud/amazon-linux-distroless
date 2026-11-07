# Versioned Java runtimes

RFC [#41](https://github.com/rambow-cloud/amazon-linux-distroless/issues/41) expands the delivered Java 21 line to Corretto Java 17, 21 and 25. Each line has separate package inputs, a module contract, native amd64/arm64 locks, GHCR package and immutable release references. The original [Java 21 release](JAVA21-RELEASE.md) remains available. Java 17/25 are candidates until native qualification and trusted-main publication provide delivery evidence.

| Java line | Input specification | Module contract | Native locks | Intended package / preview alias |
| --- | --- | --- | --- | --- |
| 17 | [packages](../images/java17/packages.json) | [modules](../images/java17/runtime.json) | `locks/java17/linux-{amd64,arm64}.json` | `ghcr.io/rambow-cloud/amazon-linux-distroless/java17:17-preview` |
| 21 | [packages](../images/java21/packages.json) | [modules](../images/java21/runtime.json) | `locks/java21/linux-{amd64,arm64}.json` | `ghcr.io/rambow-cloud/amazon-linux-distroless/java21:21-preview` |
| 25 | [packages](../images/java25/packages.json) | [modules](../images/java25/runtime.json) | `locks/java25/linux-{amd64,arm64}.json` | `ghcr.io/rambow-cloud/amazon-linux-distroless/java25:25-preview` |

AWS documents official headless, devel and JMods packages for [Corretto 17](https://docs.aws.amazon.com/corretto/latest/corretto-17-ug/amazon-linux-install.html) and [Corretto 25](https://docs.aws.amazon.com/corretto/latest/corretto-25-ug/amazon-linux-install.html). Actual patch releases come from each committed lock, never a floating system alternative. Each JRE is linked using the exact matching major, version, release and architecture of the locked runtime's Corretto JDK/JMods. Every linked module's input hash is recorded. Modules are explicit: Java 25 does not request the separate `jdk.crypto.ec` module, which is absent from its JDK module layout. Do not silently drop missing modules or assume identical module sets between Java majors. Parity is required between architectures within a major.

Native resolution of the reviewed `2023.12.20261102` repository snapshot produced Corretto RPM versions **17.0.21.0.11**, **21.0.13.0.11** and **25.0.5.0.10**. Java 17 [resolution run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42333108228) and Java 25 [resolution run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42333112007) verified binary/source RPMs on both architectures; the tool JVM's native module inventory contains every requested root module. Runtime image qualification and publication remain separate requirements.

All lines follow the [headless runtime contract](JAVA21.md): direct `/usr/bin/java`, `JAVA_HOME=/opt/java`, UID/GID 65532, UTF-8/UTC, system/JVM trust, basic fonts/ImageIO and required native closure, with no compiler implementation, shell, package manager, RPM database or JMods. Applications requiring runtime compilation, interactive GUI, additional fonts or arbitrary JNI dependencies need separately qualified application dependencies. Compile application bytecode for the chosen Java line using a compatible JDK builder; newer bytecode cannot be run on older Java runtimes.

The locked `glibc-minimal-langpack` C.UTF-8 locale files are selected explicitly. This supports Java 17's environment-derived default charset and native Unicode filename conversion on every line. The UTF-8 probe also creates, writes, reads and removes a file with a Unicode name; passing only the JVM charset property is insufficient.

## Actions configuration

The existing `scripts/java21` directory, `images/java21/Dockerfile` and workflow filenames remain compatibility entry points. Their implementation now selects the major from the third positional argument (build/verify/lock), or `JAVA_MAJOR`, defaulting to 21. Only 17, 21 and 25 are accepted. Container commands are rejected outside GitHub Actions.

```sh
gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref UPDATE_BRANCH -f major=17
gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref UPDATE_BRANCH -f major=25
```

Download the candidate artifacts and review both native locks for the selected major before committing them. Lock artifacts include the installed tool JVM's module list for each architecture. Package signatures, binary/source checksums and exact tool identities remain required. Every PR changing shared Java assembly, configuration or fixtures runs all six native major/architecture combinations. The protected check retains its historical `Java 21 gate` name and now requires the entire matrix. Documentation-only PRs skip image builds while still reporting that gate.

After native qualification and integration into main, publish one major per trusted manual run:

```sh
gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=17
gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=25
```

Each publication rebuilds both architectures at the actual trusted source commit, rejects reports from another Java major, verifies complete payload scan coverage, preserves corresponding source in a prerelease, signs/attests immutable artifacts and advances only that major's preview alias after signature verification. Use the actual `published.json` digest for consumers. GHCR package visibility is independent for each newly created package and must be Public for anonymous pulls. Existing immutable release tags are never silently overwritten by a rerun.

The keyless certificate identity remains `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/java21-publish.yml@refs/heads/main`. The issuer is `https://token.actions.githubusercontent.com`; the exact qualified-build predicate type is recorded with the release. Retired comparison workflows remain disabled; production publication retains the fixable High/Critical ALAS gate and advisory-coverage limitations.

## Delivery order

Complete Java 17/21/25 qualification and public signed delivery first. Python [#21](https://github.com/rambow-cloud/amazon-linux-distroless/issues/21) follows, then Node.js [#22](https://github.com/rambow-cloud/amazon-linux-distroless/issues/22). Supporting all three Java lines does not complete the full requested language matrix or the project-wide stable-release milestones.
