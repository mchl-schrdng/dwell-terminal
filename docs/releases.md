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

Merge the version change and changelog into `main` after Quality, macOS and CodeQL pass. Create an annotated tag whose version matches the package. The initial release uses:

```sh
git tag -a v0.1.0 -m "Dwell 0.1.0"
git push origin v0.1.0
```

The Release checks workflow verifies the version and actor, repeats CI, tests the packaged macOS app and uploads `Dwell-macos-arm64`. It does not publish using a bot account.

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

Build locally with `npm run package`. Output is in `release/v<version>/`, with the ZIP and checksum in `release/`. Never replace a bundle that is currently running. Signing and notarization are not configured.
