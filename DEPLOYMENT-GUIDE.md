# 🚀 Deployment Guide - Private Client Configurations

Since your client configurations are **gitignored** (kept private), you need a deployment strategy to get them to your production server.

---

## 🔒 What's Private vs Public

### **Public (In GitHub):**
✅ Core configuration system files
✅ `configLoader.js`, `themeApplier.js`, `default.js`
✅ Documentation and guides
✅ Empty client directories (with .gitkeep)

### **Private (NOT in GitHub):**
🔒 Client-specific config files (`client-a.js`, `client-b.js`, etc.)
🔒 Client logos and favicons
🔒 Any sensitive branding information

---

## 📦 Deployment Options

### **Option 1: Manual Upload (Simple)**

**For each deployment:**

1. **Deploy your code from GitHub** (as usual)
2. **Manually upload client configs** via FTP/SSH:
   ```bash
   # Upload client config
   scp src/config/clients/client-a.js user@server:/path/to/app/src/config/clients/
   
   # Upload client assets
   scp -r src/assets/clients/client-a/ user@server:/path/to/app/src/assets/clients/
   ```

3. **Set the client ID** in deployed `index.html`:
   ```html
   <meta name="client-id" content="client-a">
   ```

✅ **Best for:** Small number of deployments, simple setup

---

### **Option 2: Environment Variables (Recommended)**

Store client configs outside the codebase:

**Step 1: Create a separate private repo for configs**
```bash
# Create a new private repo: "cbt-app-configs"
mkdir cbt-app-configs
cd cbt-app-configs
git init

# Add your client configs
mkdir clients
cp ../testingAG/src/config/clients/*.js clients/
cp -r ../testingAG/src/assets/clients/* assets/

git add .
git commit -m "Private client configurations"
git remote add origin https://github.com/yourusername/cbt-app-configs.git
git push -u origin main
```

**Step 2: During deployment, clone both repos**
```bash
# Clone main app (public)
git clone https://github.com/yourusername/7thGen-CBT-APP.git

# Clone configs (private)
git clone https://github.com/yourusername/cbt-app-configs.git

# Copy configs to app
cp cbt-app-configs/clients/*.js 7thGen-CBT-APP/src/config/clients/
cp -r cbt-app-configs/assets/* 7thGen-CBT-APP/src/assets/clients/
```

✅ **Best for:** Multiple deployments, version control for configs

---

### **Option 3: Build-Time Injection (Advanced)**

Inject configs during build/deployment:

**Step 1: Store configs in deployment platform**
- Netlify: Use environment variables or build plugins
- Vercel: Use environment variables
- Custom server: Use deployment scripts

**Step 2: Create a build script**
```javascript
// build-with-client.js
const fs = require('fs');
const clientId = process.env.CLIENT_ID || 'default';

// Copy client config from secure location
const configSource = `/secure/configs/${clientId}.js`;
const configDest = `src/config/clients/${clientId}.js`;
fs.copyFileSync(configSource, configDest);

// Set meta tag
const indexHtml = fs.readFileSync('src/index.html', 'utf8');
const updatedHtml = indexHtml.replace(
  '</head>',
  `  <meta name="client-id" content="${clientId}">\n</head>`
);
fs.writeFileSync('src/index.html', updatedHtml);
```

**Step 3: Run during deployment**
```bash
CLIENT_ID=client-a node build-with-client.js
npm run build
```

✅ **Best for:** Automated deployments, CI/CD pipelines

---

### **Option 4: Server-Side Config Loading (Most Secure)**

Load configs from a secure backend:

**Step 1: Store configs in a database or secure API**

**Step 2: Modify configLoader.js to fetch from API**
```javascript
async loadConfig(clientId = 'default') {
  try {
    // Fetch from secure backend
    const response = await fetch(`https://your-api.com/configs/${clientId}`);
    const clientConfig = await response.json();
    
    this.config = this.mergeConfigs(defaultConfig, clientConfig);
    return this.config;
  } catch (error) {
    // Fallback to default
    this.config = defaultConfig;
    return this.config;
  }
}
```

**Step 3: Secure your API**
- Require authentication
- Rate limiting
- Only return configs for authorized domains

✅ **Best for:** Maximum security, dynamic config updates

---

## 🎯 Recommended Approach

### **For Your Use Case:**

I recommend **Option 2: Separate Private Repo**

**Why:**
- ✅ Version control for configs
- ✅ Easy to manage multiple clients
- ✅ Secure (private repo)
- ✅ Simple deployment workflow
- ✅ Can be automated

**Setup:**
1. Create private repo: `cbt-app-configs`
2. Store all client configs there
3. During deployment, clone both repos
4. Copy configs to main app
5. Deploy!

---

## 📝 Deployment Checklist

### **For Each Client Deployment:**

- [ ] Clone/pull main app repo
- [ ] Clone/pull configs repo (if using Option 2)
- [ ] Copy client config to `src/config/clients/`
- [ ] Copy client assets to `src/assets/clients/`
- [ ] Set client ID in `index.html` meta tag
- [ ] Test configuration loads correctly
- [ ] Verify logo and colors appear
- [ ] Test both light and dark modes
- [ ] Deploy to production
- [ ] Verify on live site

---

## 🔐 Security Best Practices

1. **Never commit sensitive data**
   - No API keys in configs
   - No passwords
   - No private information

2. **Use private repos for client data**
   - Keep configs in separate private repo
   - Limit access to authorized team members

3. **Secure your deployment process**
   - Use SSH keys, not passwords
   - Limit server access
   - Use environment variables for secrets

4. **Audit access**
   - Track who has access to configs
   - Review permissions regularly
   - Remove access when team members leave

---

## 🛠️ Quick Commands

### **Check what's gitignored:**
```bash
git status --ignored
```

### **Remove already-tracked files from Git:**
```bash
# If you already pushed client configs and want to remove them
git rm --cached src/config/clients/*.js
git rm --cached -r src/assets/clients/*/
git commit -m "Remove client configs from version control"
git push
```

### **Verify gitignore is working:**
```bash
# Try to add a client config
git add src/config/clients/client-a.js
# Should say: "The following paths are ignored by one of your .gitignore files"
```

---

## 📞 Need Help?

**Common Issues:**

**Q: Client config not loading after deployment?**
- ✅ Check file was uploaded to server
- ✅ Verify file path is correct
- ✅ Check browser console for errors

**Q: Logo not showing?**
- ✅ Ensure assets folder was uploaded
- ✅ Check file permissions on server
- ✅ Verify path in config file

**Q: Want to switch from private to public?**
- ✅ Remove lines from `.gitignore`
- ✅ `git add src/config/clients/`
- ✅ `git commit` and `git push`

---

## ✅ Summary

**What you did:**
- ✅ Added client configs to `.gitignore`
- ✅ Kept system files public
- ✅ Kept client-specific data private

**What to do next:**
1. Choose a deployment option (I recommend Option 2)
2. Set up your deployment workflow
3. Test with one client first
4. Scale to multiple clients

**Remember:**
- Public repo = Core system (safe to share)
- Private configs = Client branding (keep secure)
- Deploy both together for each client

---

**Happy deploying! 🚀**
