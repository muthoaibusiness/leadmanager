---
title: "Phone shares WSL dev server via Windows portproxy 8173, not a new port"
author: Asad
date: 2026-11-14
branch: recovery-backup
cost: { minutes: 1, tokens: 59600 }
id: l-66e9ec9c
scope: repo
status: active
src: agent
touches:
  - package.json
---

## Decided
Share the WSL Vite dev server (package.json "dev" script, vite) to a phone on the same Wi-Fi by repointing the existing Windows portproxy 8173 -> WSL IP 5174. Phone URL is http://192.168.0.203:8173/ . WSL vite must run with --host 0.0.0.0 (default localhost bind makes the proxy time out).

## Tried and ruled out
- Adding a second share port 5174 with its own portproxy: duplicates 8173, firewall still blocks inbound; rejected.
- Pointing 8173 at WSL 5173: vite there binds 127.0.0.1 only, curl from eth0 returns 000; rejected.
- New share port 5174 proxy + firewall rule: works but redundant; rejected after user named 8173 as the share port.

## Watch out
- Windows LAN IP for the share is 192.168.0.203 (Ethernet), Wi-Fi adapter is .167; phone reaches .203 on the same subnet.
- netsh portproxy and New-NetFirewallRule need elevated PowerShell; WSL IP changes on reboot, repoint connectaddress then.

In the code:
  package.json: "dev": "vite" -> run npm run dev -- --host 0.0.0.0 --port 5174
  netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=8173
  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8173 connectaddress=172.23.208.116 connectport=5174
  New-NetFirewallRule -DisplayName "Vite Share 8173" -Direction Inbound -Protocol TCP -LocalPort 8173 -Action Allow -Profile Any
