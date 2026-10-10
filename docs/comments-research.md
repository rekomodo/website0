# Comments for this Hugo site

Researched October 10, 2026. This is a proposal only; no comment service, account, repository permission, backend, or embed has been configured.

## Recommendation

Use **giscus** if requiring a GitHub account is acceptable. It is the smallest change for a technical blog. If visitors need email or anonymous access and you want control over the data, use **Remark42** on a separate server. Building a custom system is possible, but would introduce substantially more work than either option.

The site can remain statically generated and hosted exactly as it is. A browser-side widget fetches and submits comments to a separate service. Only that service needs a dynamic backend; Hugo still produces HTML, CSS, and JavaScript. Comments would not appear in the generated HTML or RSS feed by default.

## Options and effort

These are my engineering estimates for this repository, not vendor guarantees. They include basic integration and verification; provisioning and account approvals can add time.

| Approach | Initial effort | Hosting and maintenance | Visitor experience |
| --- | --- | --- | --- |
| giscus | About 1–2 hours | Free hosted widget; GitHub stores discussions. No application server or database to operate. | Requires a GitHub account and authorization to post. |
| Utterances | About 1–2 hours | Free hosted widget; GitHub stores issues. Similar operational effort to giscus. | Also requires GitHub authorization; simpler issue-based discussion. |
| Self-hosted Remark42 | Roughly half a day to one day, assuming an available server | Run a persistent service, manage HTTPS, upgrades, backups, and moderation. Server costs depend on the provider. | Can support social sign-in, email, or anonymous comments. |
| Custom API and database | Several days for a prototype; one or more weeks for a dependable public version | Maintain endpoints, storage, authentication, abuse controls, deployment, monitoring, and backups. | Fully customizable, including an appearance that closely matches the site. |

### giscus

[giscus documentation](https://giscus.app/) describes its GitHub Discussions storage, free hosted service, moderation through GitHub, and theme support. It requires a public repository with Discussions enabled and the giscus app installed. This can be a dedicated comments repository; the website source repository does not need to become public.

A future implementation would add the generated widget configuration to a Hugo partial, associate each article with a discussion, and load it only on article pages. Use a stable article identifier or fixed discussion number if URLs may change, and configure strict matching where applicable. Lazy loading would keep the homepage and initial article load light.

The main tradeoffs are GitHub login friction, public discussion data, dependency on GitHub and the hosted widget, and limited styling inside an iframe. No secret belongs in the page source. Maintaining a separate comments repository also keeps discussions out of development work.

[Utterances](https://utteranc.es/) follows a similar pattern using GitHub Issues. It is a reasonable alternative if issue-based threads are preferred; I would choose giscus for Discussions and reactions.

### Remark42

[Remark42's installation guide](https://remark42.com/docs/getting-started/installation/) recommends Docker. The proposed architecture is the existing static website plus a separate service at a subdomain such as `comments.jairsantana.com`. The service needs HTTPS, a persistent data volume, an application secret, site configuration, and an administrator identity. Embed its widget in the article template after the post content.

[Its authentication documentation](https://remark42.com/docs/configuration/authorization/) supports email and anonymous access as well as OAuth providers. Email requires delivery configuration; OAuth requires provider setup. Anonymous access reduces reader friction but increases moderation work.

[Automatic backups](https://remark42.com/docs/backup/backup/) are available, but backups should also be copied off the server and periodically restored in a test environment. Avatars and uploaded images require separate backup attention. The sustained work is operating and moderating the service, rather than modifying Hugo.

### Custom backend

A separate comments API could expose an article-scoped read endpoint and a write endpoint backed by a database. Keep unapproved submissions separate from published comments. The frontend should render plain text or safely sanitized Markdown, and the server must validate requests, enforce length limits, rate-limit submissions, and enforce admin access. Add spam filtering, deletion and moderation tools, backup/restore, and monitoring before treating it as production ready.

No full-site framework migration is necessary: the static article can call this API. The main reason to build it would be unusually specific design, identity, or moderation requirements that existing services cannot satisfy.

## Integration point in this repository

`layouts/_default/single.html` already has a conditional call to `partials/comments.html`. PaperMod supplies an empty comments partial. A future integration can override it in `layouts/partials/comments.html` and enable comments only for the posts section. Leave About and other standalone pages out.

Verify thread mapping across homepage/article navigation, moderation and login, mobile layout, keyboard access, service failures, and any theme changes. Keep post identifiers stable so renames do not detach existing conversations. Select the provider before adding scripts or changing account permissions.
