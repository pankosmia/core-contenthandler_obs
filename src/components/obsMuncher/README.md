# pankosmia-obs-muncher

`pankosmia-obs-muncher` provides reusable OBS-flavored muncher components for the Pankosmia ecosystem.

This package contains a set of focused UI tools that can be integrated into Pankosmia clients when OBS (Open Bible Stories) editing or visualization capabilities are needed.

> **Note:** This package does not contain everything available inside `pankosmia/core-contenthandler_obs`. It only exposes reusable components that may or may not be used by other Pankosmia clients.

## Components

### `OBSEditorMuncher`

A component that allows users to edit an OBS (Open Bible Stories) document.

It provides the editing interface required to create and modify OBS content.

---

### `OBSViewerMuncher`

A component that allows users to view an OBS (Open Bible Stories) document.

It is intended for read-only visualization use cases where editing capabilities are not required.

---

## Scope

This package contains only reusable OBS-related components.

Included:

- OBS editing components
- OBS viewing components

Not included:

- The complete `pankosmia/core-contenthandler_obs` application
- Application-specific features
- Internal tools that are not intended for reuse

The goal of this package is to provide lightweight, reusable building blocks for OBS features across the Pankosmia ecosystem.

## Testing

To test the Muncher components locally:

1. Start the development server:

```bash
pnpm run dev
```

2. Navigate to:
   `/#/MuncherTest`

## Publishing

To publish this package to npm, use the following command:

```bash
pnpm run publish
```
