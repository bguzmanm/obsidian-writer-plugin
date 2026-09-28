#!/usr/bin/env bash
# Publica una release de GitHub con los assets que BRAT necesita
# (main.js, manifest.json, styles.css). El tag DEBE coincidir con la
# versión de manifest.json, porque BRAT lo usa para comparar actualizaciones.
#
# Uso:
#   scripts/release.sh              # release con la versión actual del manifest
#   scripts/release.sh 1.1.0        # bump de versión y release
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "${1:-}" ]; then
	node -e "
		const fs = require('fs');
		const ver = process.argv[1];
		const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
		m.version = ver;
		fs.writeFileSync('manifest.json', JSON.stringify(m, null, '\t') + '\n');
		const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
		p.version = ver;
		fs.writeFileSync('package.json', JSON.stringify(p, null, '\t') + '\n');
		const v = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
		v[ver] = '1.5.0';
		fs.writeFileSync('versions.json', JSON.stringify(v, null, '\t') + '\n');
	" "$1"
fi

VERSION="$(node -p "require('./manifest.json').version")"
TAG="$VERSION"

echo "Compilando…"
npm run build

echo "Release $VERSION"
git add manifest.json package.json package-lock.json versions.json scripts .gitignore
git commit -m "chore: version $VERSION" -q || true
git push origin main

# si el tag ya existe lo actualizamos, si no lo creamos
if git rev-parse "$TAG" >/dev/null 2>&1; then
	git tag -f "$TAG"
	git push origin --tags -f
else
	git tag "$TAG"
	git push origin --tags
fi

gh release create "$TAG" main.js manifest.json styles.css \
	--title "Writer $VERSION" \
	--notes "Publicación de Writer $VERSION" \
	--target main 2>/dev/null || \
	gh release upload "$TAG" main.js manifest.json styles.css --clobber

echo "Release publicada: https://github.com/bguzmanm/obsidian-writer-plugin/releases/tag/$TAG"