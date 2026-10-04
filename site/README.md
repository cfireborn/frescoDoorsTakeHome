# Hosted Hardware Set Extractor

Upload a text-based Division 08 PDF, automatically locate its likely door hardware schedule pages,
extract hardware sets locally in the browser, review their components and source regions, and
download validated JSON or the complete component schedule as an order-friendly CSV. Provenance
cards render the attached PDF pages in the browser and overlay the normalized extraction regions for
direct source verification. A manual page override is available under the advanced controls. Source
PDF bytes are not uploaded or stored. Full and partial source strikeouts remain visible in the result
and order-friendly CSV. Image-only or incomplete schedules return `needs_review`.

```bash
npm install
npm run dev
npm test
```

The Python CLI and Streamlit application in the repository root provide the corpus-tested heuristic
path. Their OpenAI vision option is a stub with mock coverage only and has not been tested against
the live API. Existing validated JSON can also be imported into the hosted application.

The hosted demo uses Fresco's public brand mark for this take-home evaluation. The bundled Inter
font is Copyright 2016 The Inter Project Authors and is licensed under the SIL Open Font License 1.1.
The complete license ships at [`public/inter-OFL.txt`](public/inter-OFL.txt).
