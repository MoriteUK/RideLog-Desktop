# Publishing Releases for Auto-Updates

The app now supports automatic updates from GitHub releases. Here's how to publish a new version:

## Prerequisites

1. **GitHub Personal Access Token**
   - Go to GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)
   - Create a new token with `repo` scope (full control of private repositories)
   - Save the token somewhere secure

2. **Set Environment Variable**
   ```powershell
   # Windows PowerShell
   $env:GH_TOKEN = "your-github-token-here"
   ```

## Publishing a Release

### 1. Update Version Number

Edit `package.json` and increment the version:
```json
{
  "version": "1.9.28",  // Increment from 1.9.27
  ...
}
```

### 2. Update Changelog

Add the new version entry at the top of the `CHANGELOG` array in `index.html`:
```javascript
const CHANGELOG = [
  { version: 'v1.9.28', date: '3 Aug 2026', changes: [
    'Your new features here',
    'Bug fixes here',
  ]},
  // ... existing entries
```

### 3. Commit Changes

```bash
git add package.json index.html
git commit -m "Bump version to 1.9.28"
git push origin master
```

### 4. Build and Publish

```bash
# Install dependencies if needed
npm install

# Build and publish to GitHub releases
npm run publish
```

This will:
- Build the Windows installer (NSIS)
- Create a new GitHub release with the version tag
- Upload the installer and auto-update files
- Users will be notified of the update on next app launch

## What Gets Published

The build process creates:
- `RideLog Setup X.X.X.exe` - Full installer for new users
- `latest.yml` - Auto-update manifest
- Additional update files for delta updates

## Testing Updates

1. Install a previous version of the app
2. Publish a new version
3. Launch the old version
4. Check Settings > Preferences for the "Check for Updates" button
5. Verify the update downloads and installs correctly

## Manual Release (Alternative Method)

If `npm run publish` fails, you can create a release manually:

1. Build the app:
   ```bash
   npm run build
   ```

2. Find the installer in `dist/`:
   - `RideLog Setup X.X.X.exe`
   - `latest.yml`

3. Create a new GitHub release:
   - Go to https://github.com/MoriteUK/RideLog-Desktop/releases
   - Click "Draft a new release"
   - Tag version: `vX.X.X` (e.g., `v1.9.28`)
   - Release title: `vX.X.X`
   - Description: Copy from changelog
   - Upload both files from `dist/`
   - Click "Publish release"

## Version Numbering

Follow semantic versioning:
- **Major** (X.0.0): Breaking changes
- **Minor** (1.X.0): New features, backwards compatible
- **Patch** (1.9.X): Bug fixes, small improvements

Current version scheme: `1.9.X` for incremental improvements

## Troubleshooting

### "GH_TOKEN not set" Error
- Make sure you've set the environment variable in the same terminal session
- On Windows, use `$env:GH_TOKEN = "token"` in PowerShell

### "Cannot publish" Error
- Ensure your GitHub token has `repo` scope
- Check you're not behind a corporate proxy
- Try deleting `node_modules` and `package-lock.json`, then `npm install`

### Users Not Getting Updates
- Check the release was published successfully on GitHub
- Verify `latest.yml` is present in the release assets
- Make sure the version in `package.json` is higher than what users have installed
