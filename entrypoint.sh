#!/usr/bin/env bash

if [[ "$2" == "" ]]
then
    ls
    git status
    git checkout $GITHUB_BASE_REF -- $1
    node /index.js $1 $1 $3 $4
else
    ls
    git status
    git checkout $GITHUB_BASE_REF -- $2
    node /index.js $1 $2 $3 $4
fi