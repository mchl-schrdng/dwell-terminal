# Contributing

Keep pull requests focused on one user-visible improvement or bug fix. Discuss larger features in an issue first. Dwell has one fixed appearance and deliberately small scope.

Use Node.js 24 and an Apple Silicon Mac:

```sh
npm ci
npm run check
npm run test:app
```

`npm run format` applies the shared formatting. Include a regression test for a behavioral fix and screenshots for visible changes. Desktop tests use a real PTY and a small interactive test program; they do not need accounts or network access.

CI checks formatting, lint, file boundaries, desktop behavior and the packaged app. CodeQL scans the JavaScript. Dependency updates are grouped weekly.

Generated output belongs in `dist/`, `release/` or `test-results/`; these are ignored. Run `npm run icons` only when changing the app icon. The committed `.icns` file lets a clean checkout build without regenerating artwork.

By contributing, you agree that your contribution is licensed under the project's [MIT license](LICENSE).
