# DMARC-WallOfShame
Github Page to shame large companies who do not implement controls to keep their own organisation and their customers.


Tracks domains that:
- Have no DMARC record
- Have DMARC policy set to p=none

## How it works

- Daily GitHub Action checks domains
- Updates `output/non_dmarc.json`
- GitHub Pages displays results

## Contributing

Add domains to:
`data/companies.json`
