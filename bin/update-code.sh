#!/bin/bash

(
	echo "updating code from github"
	cd ../grid-bot && git pull && \
	cd ../grid-host && git pull && \
	cd ../grid-apps && git pull
) | tee -a /tmp/update-code.log
