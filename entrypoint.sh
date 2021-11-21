#!/usr/bin/env bash

if [ -z "$4" ]
then
    git checkout $GITHUB_BASE_REF $1
    node /index.js $1 $1 $2 $3
else
    git checkout $GITHUB_BASE_REF $2
    node /index.js $1 $2 $3 $4
fi