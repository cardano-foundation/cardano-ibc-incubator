FROM bloxbean/yaci-cli:0.10.6@sha256:054643c8a2b6610c40beee492505344e87761860ef60c3abadd02102fac06a03 AS devkit
COPY devkit/entrypoint.sh /profile/entrypoint.sh
COPY devkit/node.properties /app/config/node.properties

FROM bloxbean/yaci-store:2.0.2.1@sha256:9a75cb006db1710a9de02b566de158d8d561058328b8e1219531d2c2c79778e9 AS history
COPY yaci/config/application.properties /app/config/application.properties
