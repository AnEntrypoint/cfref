# cfref EC2 TCP Proxy

Free-tier EC2 instance that bridges raw TCP connections to the cfref WebSocket tunnel.

## Architecture

```
Soulseek peer → EC2:53312 (TCP) → WebSocket → cfref worker → local client → localhost:53312
```

## Prerequisites

- AWS CLI installed and configured (`aws configure`)
- Free tier eligible account

## Setup

```bash
cd aws
bash setup.sh
```

This creates:
- `t2.micro` EC2 instance (free tier)
- Security group allowing TCP 53312 + SSH 22
- Key pair for SSH access
- Node.js proxy running as systemd service

## Configure Soulseek

After setup, set your Soulseek listening port to the EC2 public IP:
- Open Soulseek → Options → Login
- Set "Listening port" to the EC2 instance port (default 53312)

## SSH Access

```bash
ssh -i cfref-proxy-key.pem ec2-user@<PUBLIC_IP>
```

## View Logs

```bash
ssh -i cfref-proxy-key.pem ec2-user@<PUBLIC_IP> 'journalctl -u cfref-proxy -f'
```

## Teardown

```bash
bash teardown.sh
```

**Important:** Terminate when not in use to stay within free tier limits.
