#!/usr/bin/env bash

if [ -z "$4" ]
then
    node /index.js $1 $1 $2 $3
else
    node /index.js $1 $2 $3 $4
fi