# Oracle Cloud Free Tier — Server Setup Guide

FreeTurtle runs great on Oracle Cloud's free ARM instance: 4 CPUs, 24 GB RAM, always free.

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
1. Go to **Resources > Route Tables > Default Route Table**
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
- OCPUs: **4**
- Memory: **24 GB**
- This is the free tier ARM shape. Do NOT select VM.Standard.E2.1.Micro (1 CPU / 1 GB RAM — too small)

### 4. Security
- Shielded instance: **Off**
- Confidential computing: **Off**

### 5. Networking
1. Primary network: **Select existing virtual cloud network** > your VCN
2. Subnet: **Select existing subnet** > your public subnet
3. Private IPv4: Automatically assign
4. **Public IPv4: Toggle ON**

### 6. Boot Volume
- Default 46.6 GB — fine as-is
- In-transit encryption: enabled
- Estimated cost may show ~$2/month — this is a display bug, actual cost is $0

### 7. SSH Keys
- Select **Generate a key pair for me**
- **Download both private key and public key BEFORE creating the instance**
- You cannot retrieve the private key later

### 8. Create
If you get "Out of capacity":
- Try a different Availability Domain
- Try reducing to 2 OCPUs / 12 GB RAM
- Make sure your account is upgraded to Pay-As-You-Go

## Server Setup

### SSH In
```bash
chmod 400 ~/path/to/private-key.key
ssh -i ~/path/to/private-key.key ubuntu@<PUBLIC_IP>
```

### Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Install pnpm
```bash
npm install -g pnpm
```

### Install FreeTurtle
```bash
pnpm install -g freeturtle
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

## Opening Firewall Ports

Oracle has two firewalls — the cloud security list AND the OS-level firewall.

If you need to open a port (e.g. for a webhook):

**Cloud Security List:**
1. Networking > VCN > your VCN > your subnet > Default Security List
2. Add Ingress Rule for the port

**OS-level firewall:**
```bash
sudo iptables -I INPUT -p tcp --dport <PORT> -j ACCEPT
```

SSH (port 22) is open by default.

## Important Notes

- Oracle may send warnings about idle free tier instances — upgrading to PAYG prevents most issues
- Treat the server as disposable — keep your `~/.freeturtle/` config backed up or in git
- If the instance is lost, a full rebuild takes ~15 minutes on any new server
- The ARM instance is always free as long as you stay within the free tier limits (4 OCPUs / 24 GB total across all A1 instances)
