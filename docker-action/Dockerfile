FROM node:16

COPY . /

RUN yarn

RUN chmod +x entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]