# u(nlinked)HTTP latency monitor

Measure roundtrip latency through uHTTP network.

## Development setup

- Copy `.env.sample. to `.env` and adjust values as needed.
- Build application with `yarn build`
- Start application with `export $(cat .env) && yarn start`

## Docker setup

- Build container with `docker build -t uhttp-latency-monitor .`
- Run container with `docker run --env-file .env --platform linux/amd64 uhttp-latency-monitor`
