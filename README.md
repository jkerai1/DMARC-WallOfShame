# DMARC-WallOfShame
List of companies who do not implement controls to keep their own organisation and their customers safe with the most basic of controls. ```p=none``` is a temporary measure and your domain should not be ```p=none``` forever. 


Tracks domains that:
- Have no DMARC record
- Have DMARC policy set to p=none

## How it works

- Daily GitHub Action checks domains. If the company remediates then they get cleared down.
- Updates `docs/non_dmarc.json`
- GitHub Pages displays results

## Contributing

Add domains to:
`data/companies.json`

> Smaller players will not be accepted due to the fact it will flood the site. Large companies by Revenue (or Employee/Customer count), Government Entities, Software with a huge supply chain that could cause an supply chain attack,an Alexa top 1M domain (or equivalent ranking), IT/security companies that should know better, a company that holds signficant PII or is involved in significant infrastructure that if hacked would cause physical destruction or loss of life.


> [!NOTE]
> Even if your domain is not intended to send email it should still have DMARC of p=reject and be parked, for example, v=spf1 -all which permits no IP to send mail. Follow Guidance here: https://www.ncsc.gov.uk/blog-post/protecting-parked-domains
> [!NOTE]
> Also Note if your company uses Entra/Microsoft 365 you still need to DMARC your .onmicrosoft.com domain. https://o365info.com/dkim-dmarc-onmicrosoft-com-domain/. This repo will not include .onmicrosoft.com domains.
