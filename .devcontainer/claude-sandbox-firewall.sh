#!/usr/bin/env bash
# Per-container egress lockdown. Everything direct is blocked; all outbound
# HTTP(S) must go through the host-side hostname-allowlisted proxy at
# 172.17.0.1:8888 (claude-sandbox-proxy). DNS is allowed so container apps can
# resolve the destination before CONNECT; that lookup does not itself egress
# anything useful.
set -euo pipefail

iptables -F OUTPUT
iptables -P OUTPUT DROP

# Loopback.
iptables -A OUTPUT -o lo -j ACCEPT

# DNS: restrict to the nameservers actually configured in the container.
# Only accept numeric (IPv4) nameserver literals — skip hostnames, IPv6
# link-local, and anything else that would either error iptables or silently
# pin a resolved address. IPv6 DNS is blocked by the v6 default-DROP below.
while read -r _ ns _; do
    case "$ns" in
        ''|'#'*) continue ;;
        *[!0-9.]*) continue ;;  # non-numeric → skip (hostname, v6, etc.)
    esac
    iptables -A OUTPUT -d "$ns" -p udp --dport 53 -j ACCEPT
    iptables -A OUTPUT -d "$ns" -p tcp --dport 53 -j ACCEPT
done < <(grep -E '^nameserver ' /etc/resolv.conf || true)

# Return traffic for established connections.
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# The egress proxy on the docker bridge. All HTTP(S) egress funnels here.
iptables -A OUTPUT -d 172.17.0.1 -p tcp --dport 8888 -j ACCEPT

# IPv6: default-DROP everything. The proxy only listens on v4, and no
# allowlisted destination needs IPv6 from inside the container. Leaving v6
# default-ACCEPT would silently bypass the v4 allowlist.
if command -v ip6tables >/dev/null 2>&1; then
    ip6tables -F OUTPUT 2>/dev/null || true
    ip6tables -P OUTPUT DROP 2>/dev/null || true
    ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
fi

# Nothing else. HTTPS_PROXY / HTTP_PROXY in the env steers well-behaved apps
# through the proxy; anything trying to bypass lands in DROP.
