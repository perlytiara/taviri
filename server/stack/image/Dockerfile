# The vault image: stock Vaultwarden plus our name and icon.
# Built on the Pi by `vaultctl build` (docker compose build). Nothing secret goes in here.
ARG VW_VERSION

FROM docker.io/vaultwarden/server:${VW_VERSION} AS upstream

FROM docker.io/library/alpine:3.22 AS brand
ARG VW_VERSION
RUN apk add --no-cache python3 py3-fonttools rsvg-convert font-inter nodejs
# The server's email and admin templates come from the same release as the binary.
ADD https://github.com/dani-garcia/vaultwarden/archive/refs/tags/${VW_VERSION}.tar.gz /src/vaultwarden.tar.gz
COPY --from=upstream /web-vault /stock/web-vault
COPY brand.env icon.svg mark.svg glyph.svg about.html.tmpl rebrand.py brand.scs[s] /brand/
RUN python3 /brand/rebrand.py \
      --web-vault /stock/web-vault \
      --source /src/vaultwarden.tar.gz \
      --brand /brand \
      --out /out \
      --vw-version "${VW_VERSION}"

FROM docker.io/vaultwarden/server:${VW_VERSION}
COPY --from=brand /out/web-vault /brand/web-vault
COPY --from=brand /out/templates /brand/templates
COPY --from=brand /out/kit /brand/kit
ENV WEB_VAULT_FOLDER=/brand/web-vault \
    TEMPLATES_FOLDER=/brand/templates
