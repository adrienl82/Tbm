ARG BUILD_FROM
FROM ${BUILD_FROM}

# nodejs/npm pour lancer le recorder, git pour recuperer/mettre a jour le
# code du repo au demarrage (voir run.sh).
RUN apk add --no-cache nodejs npm git

COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
