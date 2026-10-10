# Personal website

Hello!

A static Hugo blog at [jairsantana.com](https://jairsantana.com/), using PaperMod with local layout and style overrides inspired by [samcurry.net](https://samcurry.net/).

## Local preview

Install Hugo extended (at least the version required by the PaperMod theme), then run:

```sh
hugo server --disableFastRender
```

If port 1313 is occupied, add `--port 1314`. Build deployable files in `public/` with:

```sh
hugo --cleanDestinationDir
```

The clean build removes stale output for deleted posts. `public/` is generated and ignored by Git.

## Editing

- Posts live in `content/posts/`; About lives in `content/about.md`.
- Layout overrides live in `layouts/`; styles are in `assets/css/extended/samcurry.css`.
- The sun/moon toggle uses `layouts/partials/theme_toggle.html` and `assets/js/theme-toggle.js`.
- Site settings, menus, and pagination are in `hugo.toml`.

Comments are not enabled. See [the comments hosting investigation](docs/comments-research.md) for options, estimated effort, and a suggested future integration.
