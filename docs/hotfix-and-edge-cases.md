# Hotfixes and Edge Cases

## Hotfix Flow

When you need to deploy a critical fix to production **immediately**, bypassing the normal staging and release PR flow:

### Method 1: Emergency Hotfix Branch (Fastest - ~5-10 minutes)

This creates and releases a hotfix **directly to production** without going through staging or release PR approval.

```bash
# 1. Create hotfix branch from the current production tag
git fetch --tags
git checkout -b hotfix/v1.2.4 backend-v1.2.3  # Create from last prod tag
# OR for web: git checkout -b hotfix/v0.5.1 web-v0.5.0

# 2. Apply the fix
# ... make your changes ...
git commit -m "fix: patch critical authentication vulnerability

SECURITY: Fixes CVE-2024-xxxxx allowing bypass of auth"

# 3. Push hotfix branch
git push origin hotfix/v1.2.4

# 4. Automatic hotfix release (happens in background)
# → release-please creates release for hotfix branch
# → Images built and tagged with v1.2.4 immediately
# → Git tags created
# → Flux deploys to production within 5 minutes

# 5. ⚠️ IMMEDIATELY merge hotfix to main (REQUIRED!)
git checkout main
git pull origin main
git merge hotfix/v1.2.4
git push origin main
# This prevents the bug from returning in the next release
```

**What happens:**
- Pushes to `hotfix/**` branches trigger `.github/workflows/hotfix-release.yml`
- release-please processes the hotfix branch commits
- Images are built and tagged with the release version **immediately**
- No release PR required - direct to production
- Total time: ~5-10 minutes

**⚠️ CRITICAL: Always merge hotfix branches back to main!**
- If you don't merge to main, the next release from main will **reintroduce the bug**
- main won't have the fix, so future releases are broken
- Create a PR to main immediately after deploying the hotfix

### Method 2: Fast-Track Main Branch Release (~15-30 minutes)

For less critical fixes that can go through staging first:

```bash
# 1. Create and merge fix to main
git checkout -b fix/payment-bug
# ... fix the bug ...
git commit -m "fix: resolve payment processing race condition"
git push
# Merge PR to main

# 2. Images build and deploy to staging
# → main-abc1234 built
# → Flux deploys to staging

# 3. Quick verification in staging
# → Smoke test the fix (5-10 minutes)

# 4. release-please creates/updates release PR
# → "chore: release to production" with v1.2.4

# 5. Merge release PR immediately
# → Images retagged with v1.2.4
# → Flux deploys to production
```

**What happens:**
- Goes through normal flow but with expedited timeline
- Still validates in staging before production
- Requires release PR merge
- Total time: ~15-30 minutes

### Method 3: Fix on Main First, Then Hotfix (Safest - ~10-15 minutes)

This approach ensures main always has the fix, preventing accidental regression:

```bash
# 1. Create fix on main branch
git checkout -b fix/auth-vulnerability
# ... implement fix ...
git commit -m "fix: patch authentication bypass vulnerability

SECURITY: Fixes CVE-2024-xxxxx"
git push origin fix/auth-vulnerability

# 2. Merge to main immediately (create PR or fast-merge)
gh pr create --base main --head fix/auth-vulnerability \
  --title "fix: patch auth vulnerability" --body "URGENT security fix"
# → Merge PR to main (or force-merge if emergency)

# 3. Cherry-pick to hotfix branch
git fetch origin main
git checkout -b hotfix/v1.2.4 backend-v1.2.3
git cherry-pick <commit-sha-from-main>
git push origin hotfix/v1.2.4

# 4. Hotfix automatically deploys to prod
# → No need to merge back to main - already there!
```

**Advantages:**
- main always has the fix (can't forget to merge back)
- Safer - prevents regression by design
- Clear audit trail

**Disadvantages:**
- Slightly slower (~5 extra minutes)
- Fix briefly exists in staging before production

### When to Use Each Method

**Emergency Hotfix Branch (Method 1):**
✅ Production is **completely down**
✅ Security vulnerability **actively exploited**
✅ Data loss occurring **right now**
✅ Every minute counts
❌ Risk: Easy to forget merging back to main

**Fast-Track Main Branch (Method 2):**
✅ Critical bug but service still functional
✅ Security issue not yet exploited
✅ Can spare 10-15 minutes for staging test
✅ Want to ensure fix works before prod
✅ Safe - goes through staging first

**Fix Main First (Method 3):**
✅ **Recommended for most hotfixes**
✅ Production degraded but not down
✅ Want to ensure main never loses the fix
✅ Can spare 5-10 extra minutes
✅ Safest - impossible to forget merging to main

### Hotfix Best Practices

1. **Branching strategy**
   - Hotfix branches: `hotfix/v1.2.4` (for emergency, direct to prod)
   - Fix branches: `fix/bug-name` (for fast-track through staging)

2. **Version naming**
   - Hotfix branch name should match next patch version
   - Example: If prod is `v1.2.3`, create `hotfix/v1.2.4`

3. **Post-deployment (CRITICAL)**
   - Monitor production metrics closely
   - **REQUIRED: Merge hotfix back to main immediately**
     ```bash
     # After hotfix is deployed to production:
     git checkout main
     git pull origin main
     git merge hotfix/v1.2.4
     git push origin main

     # OR create a PR if you want review:
     gh pr create --base main --head hotfix/v1.2.4 \
       --title "chore: merge hotfix v1.2.4 to main" \
       --body "Merging emergency hotfix back to main to prevent regression"
     ```
   - ⚠️ **If you skip this, the fix will be lost in the next release from main!**

4. **Communication**
   - Alert team immediately when deploying hotfix
   - Confirm hotfix has been merged back to main
   - Document incident and fix in post-mortem
   - Update runbooks if process revealed gaps

### Example: Emergency Security Hotfix

```bash
# Production v1.2.3 has critical auth bypass vulnerability

# 1. Create hotfix branch from production tag
git fetch --tags
git checkout -b hotfix/v1.2.4 backend-v1.2.3

# 2. Apply security patch
# Option A: Cherry-pick if fix already exists on main
git cherry-pick abc1234

# Option B: Create fix directly on hotfix branch
# ... make changes ...
git commit -m "fix: patch authentication bypass vulnerability

SECURITY: Fixes CVE-2024-xxxxx"

# 3. Push to trigger hotfix workflow
git push origin hotfix/v1.2.4

# 4. Automatic process (runs in background):
# → hotfix-release.yml workflow triggers
# → release-please creates release
# → Backend image built and tagged: v1.2.4
# → Git tag created: backend-v1.2.4
# → Flux deploys to production (5 minutes)

# 5. Verify deployment
kubectl -n prod get pods -l app=dealbot
kubectl -n prod logs -l app=dealbot --tail=100

# 6. ⚠️ CRITICAL: Merge hotfix back to main immediately
git checkout main
git pull origin main
git merge hotfix/v1.2.4
git push origin main

# 7. Verify main has the fix
git log --oneline main -5
# Should see your hotfix commit in main now

# Total time: ~10 minutes from push to production
# IMPORTANT: Don't skip step 6 or next release will reintroduce the bug!
```

### Hotfix Workflow Details

The `.github/workflows/hotfix-release.yml` workflow:
- Triggers on pushes to `hotfix/**` branches
- Uses release-please with the hotfix branch as target
- Builds images immediately upon release creation
- Tags with both semver (`v1.2.4`) and hotfix marker (`hotfix-abc1234`)
- No staging deployment - straight to production via Flux watching semver tags

---

## Multiple Release PRs

### The Problem

What if new changes merge to main while a release PR is already open?

**Scenario:**
```
Day 1, 10am: Feature A merged (feat:) → Release PR #123 created (v0.1.0 → v0.2.0)
Day 1, 2pm:  Feature B merged (fix:) → What happens?
```

### The Solution

**release-please automatically updates the existing PR:**

1. **Updates the release PR** (#123) with new commits
2. **Recalculates version** based on all commits since last release
3. **Updates CHANGELOG.md** with new entries
4. **Updates package.json** with correct version

### Why This Approach?

✅ **Always releases latest staging** - PR always points to what's currently in staging

✅ **Single source of truth** - One PR = current release candidate

✅ **Accurate versioning** - Version reflects all changes, not just the first

✅ **Complete changelog** - All changes documented in one place

### Example Flow

```bash
# 10:00 AM - Feature A merged
git commit -m "feat: add user profiles"
# → Images built: main-abc1234
# → release-please creates PR #123: "chore: release to production"
# → Backend: v0.1.0 → v0.2.0 (minor bump for feat:)
# → CHANGELOG: "feat: add user profiles"

# 2:00 PM - Bug fix merged
git commit -m "fix: resolve profile image upload"
# → Images built: main-def5678
# → release-please UPDATES PR #123
# → Backend: v0.1.0 → v0.2.0 (still minor, feat > fix)
# → CHANGELOG now includes BOTH entries:
#     "feat: add user profiles"
#     "fix: resolve profile image upload"

# Developer reviews PR #123
# → Sees complete changelog with all changes
# → Merges PR #123
# → Both changes released to prod together as v0.2.0
```

**Note:** release-please uses git history since the last release tag to determine what's included. The version number is the highest bump needed (major > minor > patch).

---

## Deploying an Older Image

### The Problem

> "I want to deploy the image from 2 commits ago, not the latest one."

This is **not supported** by the automated workflow, and that's intentional.

### Why Not?

The GitOps principle: **Production should always be ahead of or equal to staging, never behind.**

If you want to deploy an older image:
1. That image is no longer in staging
2. You'd be deploying untested code to prod
3. You'd bypass the entire staging verification

### What to Do Instead

#### Option 1: Revert and Re-release (Recommended)

```bash
# 1. Revert the problematic commit
git revert <bad-commit-sha>
git push origin main

# 2. This merges to main
# → Builds new images with the revert
# → Deploys to staging
# → Creates release PR
# → Merge to deploy to prod

# Result: Clean history, proper testing
```

#### Option 2: Manual Override (Emergency Only)

If you absolutely must deploy an older image:

```bash
# 1. Find the SHA you want
git log  # Find the commit SHA

# 2. Manually retag in ECR
aws ecr batch-get-image \
  --repository-name filoz-dealbot \
  --image-ids imageTag=main-abc1234 \
  --query 'images[].imageManifest' \
  --output text | \
aws ecr put-image \
  --repository-name filoz-dealbot \
  --image-tag v1.2.5 \
  --image-manifest file:///dev/stdin

# 3. Tag the git repo
git tag v1.2.5 abc1234
git push origin v1.2.5

# 4. Flux will deploy within 5 minutes
```

**Warning:** This bypasses all safeguards. Only use in emergencies.

---

## Rollback Strategy

### Quick Rollback

If you need to rollback production:

```bash
# 1. Check what's currently in prod
kubectl -n prod get deployment dealbot -o jsonpath='{.spec.template.spec.containers[0].image}'
# Output: filoz-dealbot:v1.2.5

# 2. Revert to previous version
# Option A: Revert the merge commit
git revert HEAD
git push origin main

# Option B: Manual ECR retag (faster)
# Retag the previous good version with a new semver tag
# See "Manual Override" section above
```

### Prevention

The automated flow prevents most rollback scenarios:
1. **Same image staging → prod** - What you test is what you get
2. **Manual approval** - Human reviews release PR before prod deploy
3. **Gradual rollout** - Staging first, then prod

---

## FAQ

### Can I have multiple versions in flight?

No. release-please enforces one release at a time:
- Only one release PR can be open (titled "chore: release to production")
- New merges **update** the existing release PR
- This ensures you always release the latest staging state

### What if I want to release only backend, not web?

release-please automatically detects what changed:
- If only backend commits exist, only backend is released
- If only web commits exist, only web is released
- If both have changes, both are released
- Each app has independent versioning in package.json

### Can I skip a version number or force a major release?

Yes, but it requires manual intervention:

**Option 1: Use breaking change syntax**
```bash
git commit -m "feat!: redesign API endpoints

BREAKING CHANGE: Response format changed"
# This forces a major version bump
```

**Option 2: Edit package.json in release PR**
```bash
# 1. release-please creates PR with v0.2.0
# 2. Edit apps/backend/package.json in the PR branch
# 3. Change version to v1.0.0
# 4. Commit to the release PR branch
# 5. Merge the PR
```

**Option 3: Manual version edit**
```bash
# Edit package.json on main, then push
# release-please will detect the manual version change
```

### What happens if the release fails?

The release workflow will fail but staging is unaffected. Check logs:
1. Do the SHA images exist in ECR? (Check `sha-<sha>` tags)
2. Is the version already tagged in git?
3. Are AWS credentials valid?
4. Does the ECR repository exist?

Fix the issue and manually re-run the workflow via GitHub Actions UI.
