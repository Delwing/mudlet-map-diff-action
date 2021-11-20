FROM node:12

COPY . /

RUN yarn

RUN chmod +x entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]