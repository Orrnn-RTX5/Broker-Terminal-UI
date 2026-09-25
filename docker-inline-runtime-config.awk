# Both runtime generators escape HTML delimiters inside their string values.
# Reject unexpected unsafe source instead of changing JavaScript operators or
# publishing an index that could execute broker-supplied HTML.
function fail(message) {
  print "RTX runtime config: " message > "/dev/stderr"
  failed = 1
  exit 1
}

BEGIN {
  config_file = ENVIRON["RTX_RUNTIME_CONFIG_FILE"]
  while ((status = getline config_line < config_file) > 0) {
    config = config config_line "\n"
  }
  close(config_file)
  if (status < 0 || config == "") fail("cannot read a nonempty runtime configuration")
  if (tolower(config) ~ /<\/script|<!--|<script/) {
    fail("runtime configuration contains an unsafe HTML script delimiter")
  }
  # Vite base: './' emits the relative form; also support root-hosted builds.
  tag = "<script[[:space:]]+src=[\"'][.]?/runtime-config\\.js[\"'][[:space:]]*>[[:space:]]*</script>"
}

{
  remaining = $0
  while (match(remaining, tag)) {
    matches += 1
    printf "%s<script id=\"rtx-runtime-config\">\n%s</script>", substr(remaining, 1, RSTART - 1), config
    remaining = substr(remaining, RSTART + RLENGTH)
  }
  print remaining
}

END {
  if (!failed && matches != 1) fail("index template must contain exactly one external runtime-config.js script")
}
