# Liberty public procurement data

Public NYC City Record and New Jersey NJSTART notices used by Liberty. This repository contains public notices and refresh code only. It contains no customer data or credentials.

Sources: [NYC City Record](https://data.cityofnewyork.us/City-Government/City-Record-Online/dg92-zbpx) and [NJSTART](https://www.njstart.gov/bso/). Liberty is independent of government agencies.

The scheduled refresh runs hourly. GitHub may delay scheduled jobs. The application marks data stale after 24 hours and pauses exports on stale data. NJ dates are bid opening times; confirm response deadlines and amendments in official documents. Source content remains subject to its original terms.

When NYC Open Data is more than seven days behind, the refresh checks the official City Record's historical search for every procurement notice since the last source date, including awards and cancellations. It also searches current solicitations across the same 180-day coverage window to recover bid extensions, then rechecks those notices and every previously open NYC notice against their official detail pages. Pagination must be complete, and every detail must validate before the saved snapshot is replaced. A failed or still-stale source preserves the previous snapshot.

Run `npm test` to check source handling and snapshot preservation. Run `npm run refresh` to refresh `data/snapshot.json` on this computer. This command does not publish or install a local schedule.
