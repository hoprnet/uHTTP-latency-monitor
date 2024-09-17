# u(nlinked)HTTP latency monitor

Measure roundtrip latency through uHTTP network.

## Development setup

-   Copy `.env.sample` to `.env` and adjust values as needed.
-   Build application with `yarn build`
-   Start application with `export $(cat .env) && yarn start`

## Docker setup

-   Build container with `docker build -t uhttp-latency-monitor .`
-   Run container with `docker run --env-file .env --platform linux/amd64 uhttp-latency-monitor`

## Deployment process

To contribute to this repository you will need to create a pull request. More information about the existing automated workflows can be found in [GitHub Actions](./.github/workflows/README.md)
