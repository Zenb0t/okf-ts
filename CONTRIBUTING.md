# Contributing

Contributions are welcome through focused issues and pull requests.

## Development workflow

1. Install Node.js 20 or newer and run `npm ci`.
2. Add or update a failing test that describes the behavior being changed.
3. Make the smallest implementation change that passes the test.
4. Run `npm run check` before opening a pull request.

Changes to conformance behavior should cite the relevant section of the current [OKF specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Consumers must remain permissive toward unknown types, extension fields, broken links, and absent optional metadata.

By contributing, you agree that your contribution is licensed under Apache-2.0.
