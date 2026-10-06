# stash-librarian-fork

A personal fork of [Maista6969's Stash plugins](https://github.com/Maista6969/plugins), containing only
[librarian](./librarian/README.md).

**This is an archive, not a release.** Please read the warning in [English](#english) or [中文](#中文)
before using it.

---

## English

### What was changed

Parts of Librarian were rewritten with the help of AI (Space-Bunny) to add four behaviours that the
original plugin does not have. All four are **off by default and controlled by switches** in the plugin's
formatting panel, so the behaviour a library gets is decided there rather than by the naming pattern.
Turning all of them off reproduces the original plugin's behaviour.

1. **Shorten overlong filenames.** Every candidate filename is measured before the rename is attempted,
   so a name the filesystem cannot accept is caught in time. Without this, a name that is too long makes
   Windows fail to complete the operation, and the file then becomes awkward to access or move. When the
   name is still too long, the `{title}` field is clipped on a character boundary, and three ASCII periods
   (`...`) are placed before the closing bracket so it is obvious that the title was cut rather than being
   the complete one.

2. **Mark shortened names.** A child switch of the first, so there is a way to shorten without the marker.
   The marker takes three bytes, and they are reserved *before* the cut rather than appended after it —
   appending afterwards would push the name back over the limit and require a second trim, which makes the
   name differ between runs.

3. **Also limit the total path length.** The filename limit above applies to one path component, which is
   only the last segment. The directories above a file count against the same limit but are invisible to
   it, so once a folder pattern starts nesting scenes into subfolders, names that fitted stop fitting and
   the rename fails at the filesystem. This switch measures the rendered folder and takes its bytes off
   the top before the filename is trimmed.

   **It is a guard for a future change of layout, not something to leave enabled.** Every byte a folder
   occupies comes off the title, so a deep folder can cut a title down to a handful of characters. Leave it
   off unless files are about to move, which is the case it exists for. It also follows switch 1, since
   with nothing being shortened there is nothing for it to narrow.

4. **Numeric suffixes for split releases.** Several files that belong to one release and carry identical
   metadata (for example a two-disc set, upper and lower disc) are separate entries in Stash, so they all
   render the same filename. The original plugin fails the whole batch when this happens. Here a numeric
   suffix is added to keep every filename unique and the batch moving.

### Why this fork exists

This fork exists **only as a record**. Its purpose is to preserve these four changes in source form so
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

本 fork 使用 AI（Space-Bunny）重写了 Librarian 的部分功能，加入原版所没有的四项行为。这四项**默认全部关闭**，
由插件「格式化」栏目中的开关控制——也就是说，实际得到的行为由设置决定，而不取决于命名模板。四个开关全部关闭时，
行为与原版一致。

1. **截短过长的文件名。** 每个候选文件名都会在真正改名之前先被测量，从而及时发现文件系统无法接受的名字。
   如果没有这一步，过长的名字会让 Windows 无法完成操作，文件随后也会变得难以访问和移动。名字仍然过长时，
   `{title}` 会在字符边界处被裁短，并在结尾的 `]` 之前加上三个英文句号（`...`），以此明确表示标题是被截短的，
   而非完整标题。

2. **截短时加省略号。** 这是第 1 项的子开关，因此可以只裁短而不加标记。标记本身占三个字节，这三个字节是在
   裁剪**之前**预留的，而不是裁完再补上去——补上去会让名字重新超限、必须再裁一次，而这就导致同一个文件在
   不同轮次里算出不同的名字，文件会来回移动。

3. **同时限制完整路径长度。** 上面第 1 项的限制只针对**单个路径分量**，而路径分量只是最后一段。上层目录占用
   同一份额度，但那一层限制看不到目录，因此一旦用文件夹规则把场景放进子目录，原本放得下的名字就放不下了，
   改名会在文件系统层面失败。本开关会先测量渲染出的目录，把它的字节数从总额中扣除，再裁剪文件名。

   **它是为将来改变文件位置预留的保护，而不是一个应该长期保持开启的选项。** 目录占用多少字节，就会从标题里
   扣掉多少，因此在很深的目录下，标题可能被裁到只剩几个字符。除非你正准备移动文件，否则请保持关闭——那才是
   它存在的场景。它同时从属于第 1 项开关，因为没有裁短时它无事可做。

4. **多分卷作品加数字后缀。** 同一部作品、且带有完全相同元数据的多个文件（例如上下两碟），在 Stash 中
   是彼此独立的条目，因此会渲染出完全相同的文件名。原版插件遇到这种情况会让整批任务失败。本 fork 会在
   文件名末尾添加数字后缀，使每个文件名保持唯一，从而让整批任务能够正常完成。

### 这个 fork 存在的理由

本 fork **仅作留档**。它的用途是以源码形式保存上述四项改动，以便在原版 Librarian 未来的版本中
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
- Changes in / 本 fork 的改动：`601fc85`（字节上限与跨场景消解）、`025c675`（改为开关控制）、
  `fd8c2b5`（完整路径上限）、`0a436d2`（开关值改为 255 并补充代价说明）、
  `332ca1f`（收敛性测试）、`126c5c1`（插件改名）、`0cd3f65`（本文档）

## Licence / 许可

The upstream project is published under an [AGPL-3.0](LICENCE) license. This fork keeps the same licence.
/ 上游项目以 [AGPL-3.0](LICENCE) 发布，本 fork 保持相同许可。
