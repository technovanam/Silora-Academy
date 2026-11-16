#!/usr/bin/env bash
# Starts the Firebase Emulator Suite (Auth, Firestore, Storage) for local development.
# Uses a portable JDK 21 if JAVA_HOME isn't already pointing to Java 21+.
cd "$(dirname "$0")"
if [ -z "$JAVA_HOME" ] && [ -d "$HOME/tools/jdk-21" ]; then
  export JAVA_HOME="$HOME/tools/jdk-21"
fi
[ -n "$JAVA_HOME" ] && export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p firebase/emulator-data
exec npx --no-install firebase emulators:start --project demo-silora \
  --import=firebase/emulator-data --export-on-exit=firebase/emulator-data
