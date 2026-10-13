# Releases

Tags use `vMAJOR.MINOR.PATCH` and must match `package.json` and `package-lock.json`.

- **PATCH**: compatible bug fixes.
- **MINOR**: user-facing additions. Before 1.0, a minor version may also change behavior.
- **MAJOR**: incompatible changes after the API and behavior have stabilized at 1.0.

Only **mchl-schrdng** publishes releases. Use the account's GitHub noreply identity for commits and annotated tags:

```sh
git config --local user.name mchl-schrdng
git config --local user.email 73759636+mchl-schrdng@users.noreply.github.com
```

Merge the version change and changelog into `main` after Quality, macOS and CodeQL pass. Create an annotated tag whose version matches the package:

```sh
version=$(node -p "require('./package.json').version")
git tag -a "v${version}" -m "Dwell ${version}"
git push origin "v${version}"
```

The Release checks workflow verifies the version and actor, repeats CI, verifies the ZIP checksum and extracted code signature, tests the packaged macOS app and uploads `Dwell-macos-arm64`. Its signature regression test modifies a disposable extracted resource and requires verification to reject it. It does not publish using a bot account.

After the tag workflow succeeds, download that run's artifact and publish with the authenticated **mchl-schrdng** account:

```sh
test "$(gh api user --jq .login)" = "mchl-schrdng"
version=$(node -p "require('./package.json').version")
# Replace RUN_ID with the successful Release checks run for this tag.
gh run download RUN_ID --name Dwell-macos-arm64 --dir release/publish
(cd release/publish && shasum -a 256 -c "Dwell-${version}-macos-arm64.zip.sha256")
gh release create "v${version}" release/publish/*.zip release/publish/*.sha256 \
  --verify-tag --title "Dwell ${version}" --notes-file release/notes.md
```

Write concise release notes in `release/notes.md`, including the Apple Silicon requirement and the lack of Apple notarization. Do not move a published tag; fix problems in a new version.

Build locally with `npm run package`, then verify the archive with `npm run test:package`. Output is in `release/v<version>/`, with the ZIP and checksum in `release/`. Packaging refuses to replace that bundle while it is running; other versions can stay open.

Packaging applies an ad-hoc signature to the complete bundle and fails if signing or strict verification fails. This local signature seals the files but does not authenticate an Apple Developer ID or satisfy Gatekeeper. Apple notarization is not configured; a downloaded release may still require a manual first-launch exception. Never describe a passing `codesign` check as Gatekeeper approval.
