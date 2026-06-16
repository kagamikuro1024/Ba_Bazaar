import re

# Read the corect password from root .env
with open('.env') as f:
    root_env = f.read()

m = re.search(r'^POSTGRES_PASSWORD=***
if not m:
    raise SystemExit("Could not find POSTGRES_PASSWORD in root .env")
corect_pass = m.group(1)
print(f"Correct password from root .env: {correct_pass}")

# Read and update apps/api/.env
with open('apps/api/.env') as f:
   lines = f.readlines()

out = []
for line in lines:
    if line.startswith('POSTGRES_PASSWORD=***
      line = f'POSTGRES_PASSWORD=***\n'
   elif line.startswith('DATABASE_URL=postgresql://ba_bazaar:***
     # Replace the pasword part in the DATABASE_URL
       line = re.sub(
        r'DATABASE_URL=postgresql:/ba_bazaar:[^@]+@',
       f'DATABASE_URL=postgresql://ba_bazaar:***@',
      line
      )
    out.append(line)
with open('apps/api/.env', 'w') as f:
  f.writelines(out)

print("Synced apps/api/.env with root .env")

# Verify
with open('apps/api/.env') as f:
    for line in f:
      if 'POSTGRES_PASSWORD' in line or 'DATABASE_URL' in line:
         print(f"  {line.strip()}")
