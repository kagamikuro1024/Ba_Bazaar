FROM golang:1.22-bookworm AS build

WORKDIR /app

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/cmd ./cmd

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/ba-bazaar-api ./cmd/api

FROM debian:bookworm-slim AS runtime

ENV API_PORT=3001
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /out/ba-bazaar-api /app/ba-bazaar-api

EXPOSE 3001

CMD ["/app/ba-bazaar-api"]
