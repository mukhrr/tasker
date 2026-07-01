# Deploy the sniper to Oracle Cloud — US East (Ashburn), 24/7, free

Goal: run `sniper.mjs` on an always-free VM **physically near GitHub** so your
round-trip drops from ~300ms (home) to ~20ms (Ashburn). That latency cut is the
entire point — same code on your laptop is just as slow as the extension.

---

## 0. Prerequisites

- An Oracle Cloud account with **home region = US East (Ashburn)**.
  - Sign up at <https://www.oracle.com/cloud/free/>. A credit card is required
    for identity verification; **Always Free** resources are never charged.
  - ⚠️ The home region is chosen **once at signup and can't be changed.** You
    must pick **US East (Ashburn)** — Always Free compute lives in your home
    region. If you already have an account in another region, create a new one.
- A **classic** GitHub Personal Access Token with the `public_repo` scope
  (github.com → Settings → Developer settings → Personal access tokens (classic)).

---

## 1. Make an SSH key (on your Mac)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oracle_sniper -N ""
cat ~/.ssh/oracle_sniper.pub      # copy this whole line for step 2
```

---

## 2. Create the VM (Oracle Console)

1. Console → **Compute → Instances → Create instance**.
2. **Name:** `sniper`.
3. **Image & shape → Edit:**
   - Image: **Canonical Ubuntu 22.04**.
   - Shape: **VM.Standard.E2.1.Micro** (Always Free eligible, 1 GB RAM — plenty).
     - *Optional:* `VM.Standard.A1.Flex` (ARM, also always-free) is beefier but
       often shows “Out of capacity”. E2.1.Micro is the reliable choice.
4. **Networking:** keep the default — “Create new VCN” + public subnet, and make
   sure **Assign a public IPv4 address** is on.
5. **Add SSH keys:** choose **Paste public keys** and paste the
   `~/.ssh/oracle_sniper.pub` line from step 1.
6. **Create.** When it’s `RUNNING`, copy its **Public IP address**.

No inbound ports are needed — the sniper only makes **outbound** calls to GitHub.
SSH (port 22) is open by default in the generated VCN; leave everything else closed.

---

## 3. SSH in

```bash
chmod 400 ~/.ssh/oracle_sniper
ssh -i ~/.ssh/oracle_sniper ubuntu@<PUBLIC_IP>
```

---

## 4. Install Node 22 (on the VM)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version        # expect v22.x  (needs >=20.6 for --env-file)
```

---

## 5. Copy the sniper up (from your Mac, in a second terminal)

```bash
scp -i ~/.ssh/oracle_sniper -r /Users/mukhriddin/Desktop/tasker/sniper \
    ubuntu@<PUBLIC_IP>:~/sniper
```

(Or `git clone` your repo on the VM and use the `sniper/` subfolder.)

---

## 6. Configure `.env` (on the VM)

```bash
cd ~/sniper
cp .env.example .env
nano .env
```

Set at least:
```
GITHUB_TOKEN=ghp_...           # classic PAT, public_repo scope
DRY_RUN=true                   # keep true until you've watched it work
WATCH=                         # e.g. 92369   (issues you've staged a body for)
DISCOVER=false                 # true = whole repo (ban risk — be selective)
```
Lock the file down (it holds your token):
```bash
chmod 600 .env
```

---

## 7. Prove the latency win (the whole reason you're here)

```bash
for i in 1 2 3; do
  curl -o /dev/null -s -w "connect: %{time_connect}s  first_byte: %{time_starttransfer}s\n" \
    https://api.github.com/zen
done
```
Expect `connect` around **0.005–0.03s** (vs ~0.23–0.5s from home). That ~10–20×
cut is what moves you from HW+2s to the front of the pack.

---

## 8. Test run, then run forever with pm2

```bash
# one-shot foreground sanity check (Ctrl+C after you see it work)
node --env-file=.env sniper.mjs

# install pm2 and run as a managed, auto-restarting service
sudo npm install -g pm2
cd ~/sniper
pm2 start sniper.mjs --name sniper --node-args="--env-file=/home/ubuntu/sniper/.env"
pm2 logs sniper            # watch live; Ctrl+C just detaches the log view

# survive reboots
pm2 save
pm2 startup systemd        # prints a `sudo env ... pm2 startup ...` line — run it, then:
pm2 save
```

---

## 9. Operate

```bash
pm2 status                 # is it online?
pm2 logs sniper            # live logs
pm2 restart sniper         # after editing .env or pulling new code
pm2 stop sniper            # pause it
```

**Update code/proposals:** re-run the `scp` from step 5 (or `git pull`), then
`pm2 restart sniper`.

---

## 10. Go live checklist

1. Watch `pm2 logs sniper` in **DRY_RUN** for a while; confirm `🔒 locked` and
   `🧪 would POST … via tight-poll` with the low-latency you measured in step 7.
2. Stage real proposal bodies: `proposals/<issue#>.md` for each `WATCH` target.
3. (Optional) Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` so a snipe pings you
   to rush in and edit the placeholder into a full proposal.
4. Set `DRY_RUN=false`, then `pm2 restart sniper`. You’re live.

---

## Notes

- **Idle reclamation:** Oracle may reclaim *idle* Always Free VMs. A running
  sniper polls constantly, which keeps it active — but if you ever stop it for
  days, the VM could be reclaimed. Just recreate from these steps if so.
- **Stay on Always Free:** don’t “upgrade to Paid” or add resources beyond the
  free shapes, and you won’t be billed.
- **Rate limits:** if logs ever show `⏸️ rate-limited`, bump `TIGHT_INTERVAL_MS`
  to 120 and `DISCOVERY_INTERVAL_MS` to 1000 in `.env`, then `pm2 restart sniper`.
