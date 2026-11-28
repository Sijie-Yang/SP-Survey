# Add your study

Every study in the [template library](../README.md#template-library) started as someone's survey. To add yours, send the materials; we turn them into a template, publish it at [sp-survey.org/templates](https://sp-survey.org/templates), and add it to the list with your GitHub name on the row.

Published and unpublished studies are both welcome. If there is a paper or preprint, the template links to it and asks users to cite it.

## What to send

1. **`study.md`**: who ran the study, the paper (if any), what participants saw and what they were asked. Copy it from [`_template/study.md`](./_template/study.md).
2. **The survey itself**, in whatever form you have:
   - the question wording and answer scales (a PDF, Word file or plain text is fine),
   - or an export from the tool you used (Qualtrics `.qsf`, an SP-Survey project file, a Google Forms printout),
   - or the survey web page (`index.html`).
3. **The images, videos or sounds** participants saw. Put them in a `media/` folder next to `study.md`.

## Images and other media

Media files are welcome in the folder: most studies use a few dozen to a few hundred images, which fits. Two limits:

- Keep one study under 50 MB, and each file under 5 MB. If your set is larger, put it on OSF, Zenodo, Figshare or Hugging Face and give the link in `study.md`.
- Only add media you are allowed to share in public. If you are not sure, or the images cannot be shared, say so in `study.md`: we then build the template with the same task and scales and new images of the same kind, and label it a method replication.

## Three ways to send it

**Pull request.** Copy `contributions/_template/` to `contributions/<year>-<first-author>-<keyword>/` (for example `contributions/2024-tan-night-safety/`), fill in `study.md`, add your survey files and media, and open the PR.

**Issue.** If you do not use git, open an [Add a study](https://github.com/Sijie-Yang/SP-Survey/issues/new?template=add-study.yml) issue, answer the questions and drag your files into the text box.

**Online form.** If you have no GitHub account, fill in the [Add a template](https://sp-survey.org/add-template) form on sp-survey.org. It asks for the paper's title, authors and link, and takes your images and other files (PDF, Word, ZIP). The form needs a link to a paper or preprint, so for an unpublished study use one of the two ways above.

## What happens next

1. We read the materials and ask if something is unclear.
2. We build the template and send you a preview link to check.
3. When you are happy with it, it is published in the online library and the row appears in the README.

By contributing you confirm that you have the right to share what you send, and that the materials can be published under this repository's licence. You can ask for your template to be changed or taken down at any time.
