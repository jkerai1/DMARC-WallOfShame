import dns.resolver
import json
import os
from datetime import datetime

INPUT_FILE = "data/companies.json"
OUTPUT_FILE = "output/non_dmarc.json"


def get_dmarc_policy(domain):
    try:
        answers = dns.resolver.resolve(f"_dmarc.{domain}", "TXT")

        for rdata in answers:
            record = "".join([part.decode() for part in rdata.strings])

            if "v=DMARC1" not in record:
                continue

            tags = dict(
                part.strip().split("=", 1)
                for part in record.split(";")
                if "=" in part
            )

            return tags.get("p", "none").lower()

    except Exception:
        return None

    return None


def main():
    with open(INPUT_FILE) as f:
        companies = json.load(f)

    flagged = []

    for company in companies:
        domain = company["domain"]
        policy = get_dmarc_policy(domain)

        if policy is None:
            status = "no_dmarc"
        elif policy == "none":
            status = "p_none"
        else:
            continue  # skip compliant domains

        flagged.append({
            "name": company["name"],
            "domain": domain,
            "status": status,
            "last_checked": datetime.utcnow().isoformat()
        })

    os.makedirs("output", exist_ok=True)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(flagged, f, indent=2)


if __name__ == "__main__":
    main()
