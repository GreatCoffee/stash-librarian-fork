# stash-librarian-fork

A personal fork of [Maista6969's Stash plugins](https://github.com/Maista6969/plugins), containing only
[librarian](./librarian/README.md).

**This is an archive, not a release.** Please read the warning in [English](#english) or [中文](#中文)
before using it.

---

## English

### What was changed

Parts of Librarian were rewritten with the help of AI (Space-Bunny) to add three behaviours that the
original plugin does not have:

1. **Length checking before renaming.** Every candidate filename is measured before the rename is
   attempted, so a name the filesystem cannot accept is caught in time. Without this, a name that is too
   long makes Windows fail to complete the operation, and the file then becomes awkward to access or move.

2. **Truncation with a visible marker.** When a name is still too long, the `{title}` field is shortened
   and marked with three ASCII periods (`...`) before the closing bracket, so it is obvious that the title
   was cut rather than being the complete one. The length of the finished filename is then kept within the
   limit that network filesystems enforce.

3. **Numeric suffixes for split releases.** Several files that belong to one release and carry identical
   metadata (for example a two-disc set, upper and lower disc) are separate entries in Stash, so they all
   render the same filename. The original plugin fails the whole batch when this happens. Here a numeric
   suffix is added to keep every filename unique and the batch moving.

### Why this fork exists

This fork exists **only as a record**. Its purpose is to preserve these three changes in source form so
they can be carried over to a future version of the original Librarian, whenever that may be. It is not
meant to be used as a long-term installation, and it is not a fork that is being developed in its own right.

### ⚠️ Warning

I do not write code. All of the work here was produced by AI, and **none of it has been reviewed by a
qualified person.**

I cannot make any claim about the safety or correctness of this code. I cannot rule out that it contains
bugs, that it may lose data, or that it may behave in ways I did not anticipate and might not recognise if
they happened.

**I strongly recommend against using this plugin in any real library.** In every case, please use the
original Librarian instead.

If you do decide to try this anyway, please work on a copy of your library rather than on the real thing,
and make sure you have a working backup of your Stash database first.

---

## 中文

### 改了什么

本 fork 使用 AI（Space-Bunny）重写了 Librarian 的部分功能，加入原版所没有的三项行为：

1. **重命名前检查长度。** 每个候选文件名都会在真正改名之前先被测量，从而及时发现文件系统无法接受的名字。
   如果没有这一步，过长的名字会让 Windows 无法完成操作，文件随后也会变得难以访问和移动。

2. **截短时留下可见标记。** 名字仍然过长时，`{title}` 字段会被裁短，并在结尾的 `]` 之前加上三个英文句号
   （`...`），以此明确表示标题是被截短的，而非完整标题。此时最终文件名的长度会被控制在网络文件系统
   所允许的限制之内。

3. **多分卷作品加数字后缀。** 同一部作品、且带有完全相同元数据的多个文件（例如上下两碟），在 Stash 中
   是彼此独立的条目，因此会渲染出完全相同的文件名。原版插件遇到这种情况会让整批任务失败。本 fork 会在
   文件名末尾添加数字后缀，使每个文件名保持唯一，从而让整批任务能够正常完成。

### 这个 fork 存在的理由

本 fork **仅作留档**。它的用途是以源码形式保存上述三项改动，以便在原版 Librarian 未来的版本中
将这些功能加回。它并不是为了长期使用而维护的分支，也不是一个独立发展的项目。

### ⚠️ 警告

我完全不懂写代码，这里的全部工作都由 AI 完成，**且未经任何具备资质的人审查**。

我无法对这份代码的安全性或正确性作出任何保证。我无法排除其中存在缺陷、可能造成数据丢失，
或者可能以我未曾预料、也未必能够识别的方式运行。

**在任何情况下，我都强烈建议不要在本插件上使用真实的媒体库。** 请在任何情况下都使用原版 Librarian。

如果你仍然决定尝试，请在媒体库的副本上操作，并事先确保你的 Stash 数据库有可用的备份。

---

## Upstream / 上游

- Original / 原版：<https://github.com/Maista6969/plugins>
- Forked at commit / Fork 基点：`eb225c5` (Librarian v0.13.3)
- Changes in / 本 fork 的改动：`601fc85`

## Licence / 许可

The upstream project is published under an [AGPL-3.0](LICENCE) license. This fork keeps the same licence.
/ 上游项目以 [AGPL-3.0](LICENCE) 发布，本 fork 保持相同许可。
