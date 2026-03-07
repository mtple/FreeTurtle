# Oracle Cloud Free Tier — Server Setup Guide

FreeTurtle runs great on Oracle Cloud's free ARM instance: 2 CPUs, 12 GB RAM, always free.

> **Tip:** If you're not comfortable with cloud setup, paste this entire guide into ChatGPT, Claude, or any AI chat and ask it to walk you through step by step. It can answer questions as you go — screenshots help too.

## Account Setup

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (credit card required, $1 auth hold)
2. Your region is locked at signup (e.g. US-Ashburn)
3. **Upgrade to Pay-As-You-Go** — this is required to reliably create the ARM instance

> **Why Pay-As-You-Go?** The free tier alone often shows "Out of capacity" when creating ARM instances. Upgrading to PAYG dramatically improves availability. There's a $100 authorization hold that is NOT charged — as long as you follow this guide and select the free-tier-eligible shape, you will not be billed. This confuses people but it's how Oracle works.

## Networking Setup

Do this first — the instance creation form's inline networking option does NOT properly set up a public subnet.

### 1. Create VCN
1. Go to **Networking > Virtual Cloud Networks**
2. Click **Create VCN**
3. Name: whatever you want (e.g. `my-vcn`, `prod-network`)
4. IPv4 CIDR block: `10.0.0.0/16`
5. DNS hostnames: enabled
6. Skip IPv6

### 2. Create Internet Gateway
1. Inside your VCN, go to **Resources > Internet Gateways**
2. Create an Internet Gateway — name it anything (e.g. `my-gateway`, `internet-gw`)

### 3. Add Route Rule
1. Inside your VCN, go to **Resources > Routing > Default Route Table**
2. Click **Add Route Rules**
3. Target Type: **Internet Gateway**
4. Destination CIDR: `0.0.0.0/0`
5. Target: your gateway

**If the UI gives an error** about "Rules in the route table must use private IP as a target" — this is a known Oracle Console bug. Try:
- Refresh the page and re-enter the rule
- Use a different browser or incognito window
- **If the UI keeps failing, use OCI Cloud Shell** (terminal icon, top-right of console):
```bash
oci network route-table update \
  --rt-id <ROUTE_TABLE_OCID> \
  --route-rules '[{"destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK","networkEntityId":"<INTERNET_GATEWAY_OCID>"}]'
```
Get the OCIDs from the Route Table and Internet Gateway detail pages.

### 4. Create Public Subnet
1. Inside your VCN, go to **Resources > Subnets > Create Subnet**
2. Name: anything (e.g. `public-subnet`, `main-subnet`)
3. Subnet Type: Regional
4. CIDR: `10.0.0.0/24`
5. Subnet Access: **Public Subnet**
6. DNS Resolution: leave **Use DNS hostnames in this Subnet** checked (default)

## Creating the VM Instance

Go to **Compute > Instances > Create Instance**.

### 1. Placement
- Availability Domain: **Use the default** (if you get "Out of capacity", try a different one)
- Capacity Type: **On-demand capacity** (NOT preemptible)
- Leave fault domain and cluster placement as defaults

### 2. Image
- Operating System: **Canonical Ubuntu 24.04** (latest build)

### 3. Shape
- Click the **Ampere** tab
- Shape: **VM.Standard.A1.Flex** (ARM)
- OCPUs: **2**
- Memory: **12 GB**
- This is the free tier ARM shape. Do NOT select VM.Standard.E2.1.Micro (1 CPU / 1 GB RAM — too small)

### 4. Security
- Shielded instance: **Off**
- Confidential computing: **Off**

### 5. Networking
1. Primary network: **Select existing virtual cloud network** > your VCN
2. Subnet: **Select existing subnet** > your public subnet
3. VNIC name: anything you want — just a label (e.g. `primary`, `main`)
4. Private IPv4: Automatically assign
5. **Public IPv4: Toggle ON**

### 6. SSH Keys
- Select **Generate a key pair for me**
- **Download both private key and public key BEFORE creating the instance**
- You cannot retrieve the private key later

### 7. Boot Volume
- Leave defaults (46.6 GB, no custom size)
- Use in-transit encryption: **On** (default)
- Don't check "Encrypt this volume with a key that you manage"

### 8. Create
If you get "Out of capacity":
- Try a different Availability Domain
- Make sure your account is upgraded to Pay-As-You-Go
- Try again later — ARM capacity fluctuates

## Server Setup

### SSH In

Once your instance is running, you need to connect to it from your computer's terminal (Terminal on Mac, PowerShell on Windows).

**1. Find your key files.** When you created the instance, you downloaded a `.key` file (and a `.pub` file). Find them — probably in your Downloads folder.

**2. Create a connection folder.** Keep your key and a connect script together somewhere easy to find — like a folder on your Desktop or in your projects directory:
```bash
mkdir -p ~/Desktop/my-server-ssh
mv ~/Downloads/ssh-key-*.key ~/Desktop/my-server-ssh/
mv ~/Downloads/ssh-key-*.pub ~/Desktop/my-server-ssh/
```

**3. Lock down permissions.** SSH refuses to use a key file that other users can read:
```bash
chmod 400 ~/Desktop/my-server-ssh/ssh-key-*.key
```

**4. Find your server's public IP.** Go to **Compute > Instances** in the Oracle console, click your instance, and copy the **Public IP address**.

**5. Create a connect script.** This saves you from remembering the full command every time:
```bash
cat > ~/Desktop/my-server-ssh/connect.sh << 'EOF'
#!/bin/bash
ssh -i "$(dirname "$0")"/ssh-key-*.key ubuntu@<PASTE_YOUR_PUBLIC_IP>
EOF
chmod +x ~/Desktop/my-server-ssh/connect.sh
```

Replace `<PASTE_YOUR_PUBLIC_IP>` with your actual IP address.

**6. Connect:**
```bash
~/Desktop/my-server-ssh/connect.sh
```

Type `yes` when asked about the fingerprint. You're now on your server. From now on, just run `connect.sh` to reconnect.

Your folder should look like this:
```
my-server-ssh/
├── connect.sh
├── ssh-key-2026-02-16.key
└── ssh-key-2026-02-16.key.pub
```

> **Never share your private key file** — not in AI chats, not in screenshots, not in git. If someone has your key, they have full access to your server.

### Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Install pnpm
```bash
sudo npm install -g pnpm
```

### Install FreeTurtle
```bash
sudo pnpm install -g freeturtle
```

### Set Up Your CEO
```bash
freeturtle init
```

This walks you through naming your AI CEO, connecting Farcaster, Telegram, GitHub, etc.

### Start the Daemon
```bash
freeturtle start
```

### Install as a System Service (recommended)

This keeps FreeTurtle running after you disconnect and auto-restarts on reboot:

```bash
freeturtle install-service
```

Then verify:
```bash
systemctl --user status freeturtle
```

To survive logouts:
```bash
sudo loginctl enable-linger $(whoami)
```

### View Logs
```bash
journalctl --user -u freeturtle -f
```

Or check the log file:
```bash
cat /tmp/freeturtle/freeturtle.log
```

## Setting Up Webhooks (Farcaster mentions/replies)

Neynar webhooks require an HTTPS URL. The easiest setup is a free subdomain + Caddy (auto-HTTPS reverse proxy).

### 1. Get a Free Subdomain

If you don't have a domain, use [DuckDNS](https://www.duckdns.org) (free):

1. Sign in with Google/GitHub
2. Create a subdomain (e.g. `myturtle.duckdns.org`)
3. Set it to your server's public IP (find it: `curl ifconfig.me` on the server)

If you already have a domain, add an A record pointing a subdomain to your server IP.

### 2. Open Ports 80 and 443

Oracle has two firewalls — both need ports open.

**Cloud Security List:**
1. Networking > VCN > your VCN > your subnet > Default Security List
2. Add **two** Ingress Rules:
   - Rule 1: Source CIDR `0.0.0.0/0`, TCP, Destination Port Range `80`
   - Rule 2: Source CIDR `0.0.0.0/0`, TCP, Destination Port Range `443`

**OS-level firewall:**
```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
```

### 3. Install Caddy

```bash
sudo apt install -y caddy
```

### 4. Configure Caddy

Replace `yourname.duckdns.org` with your actual domain:

```bash
sudo tee /etc/caddy/Caddyfile <<EOF
yourname.duckdns.org {
    reverse_proxy localhost:3456
}
EOF
sudo systemctl restart caddy
```

Caddy automatically provisions and renews HTTPS certificates — no certbot or manual config needed.

### 5. Set Up the Webhook

```bash
freeturtle webhooks
```

When prompted for the webhook URL, enter: `https://yourname.duckdns.org/webhook`

### Verify It Works

```bash
curl https://yourname.duckdns.org/webhook
```

If Caddy is working, you should get a response (even if FreeTurtle isn't running yet — Caddy will return a 502).

## Opening Other Firewall Ports

Oracle has two firewalls — the cloud security list AND the OS-level firewall.

If you need to open a port:

**Cloud Security List:**
1. Networking > VCN > your VCN > your subnet > Default Security List
2. Add Ingress Rule: Source CIDR `0.0.0.0/0`, TCP, Destination Port Range: your port

**OS-level firewall:**
```bash
sudo iptables -I INPUT -p tcp --dport <PORT> -j ACCEPT
```

SSH (port 22) is open by default.

## Important Notes

- Oracle may send warnings about idle free tier instances — upgrading to PAYG prevents most issues
- Treat the server as disposable — keep your `~/.freeturtle/` config backed up or in git
- If the instance is lost, a full rebuild takes ~15 minutes on any new server
- The ARM instance is always free as long as you stay within the free tier limits (4 OCPUs / 24 GB total across all A1 instances — using 2/12 leaves room for a second instance if needed)
