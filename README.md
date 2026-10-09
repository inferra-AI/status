# status.inferralab.com

Inferra's public status page. A GitHub Actions workflow probes each component
in `checks.json` every 5 minutes (outside Inferra's cloud), records results in
`site/data.json`, and publishes `site/` to GitHub Pages. Incidents are issues
labelled `incident`: open one when something is wrong, write updates as
comments, close it when resolved.
