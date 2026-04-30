# DMARC-WallOfShame
To shame companies who do not implement controls to keep their own organisation and their customers safe with the most basic of controls.


Tracks domains that:
- Have no DMARC record
- Have DMARC policy set to p=none

## How it works

- Daily GitHub Action checks domains. If the company remediates then they get cleared down.
- Updates `output/non_dmarc.json`
- GitHub Pages displays results

## Contributing

Add domains to:
`data/companies.json`

>Smaller players will not be accepted due to the fact it will flood the site. Large companies by Revenue, Employee count, Government or a company that holds signficant PII or is involved in significant infrastructure that if hacked would cause physical destruction or loss of life.


> [!NOTE]
> Even if your domain is not intended to send email it should still have DMARC of p=reject and be parked, for example, v=spf1 -all which permits no IP to send mail. Follow Guidance here: https://www.ncsc.gov.uk/blog-post/protecting-parked-domains
