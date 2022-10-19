function mdToJSON(md) {
    let op = {};
    // 如果文件采用 CRLF 换行，替换为 LF 。
    if (md.includes('\r\n')) {
        md = md.replaceAll('\r\n', '\n');
    }
    // 解析文件头部。
    if (md.slice(0, 4) === '---\n') {
        md = md.slice(4);
        // 获取头部。
        let head = "", i = 0;
        let iter = md[Symbol.iterator]();
        // 迭代并累积，直到出现预期字符串。
        (function findTerminator(terminator, terming = "") {
            let iterNext = iter.next();
            i++;
            terming += iterNext.value;
            if (iterNext.done) return;
            if (terminator === terming) return;
            if (terminator.includes(terming)) {
                findTerminator(terminator, terming);
                return;
            }
            head += terming;
            findTerminator(terminator);
        })('\n---\n');
        md = md.slice(i);
        // 预期头部格式：以冒号分隔的键值对，键值对之间以换行。值可以是以空格分隔的数组。
        // 解析头部。
        head = head.split('\n');
        op.head = {};
        head.forEach(h => {
            let index = h.indexOf(': ');
            let key = h.slice(0, index);
            let val = h.slice(index + 2);
            if (val.includes(' ')) {
                val = val.split(' ');
            }
            op.head[key] = val;
        });
    }
    // 解析文件主体。
    // 预期数据结构 [{type: String, content: Array | String}]
    let body = [];
    let blocks = md.split('\n\n');
    blocks = blocks.map(b => b.trim());
    // 所有需要处理的特殊的字符有
    // 行内：* ** == ` \ \n 以及 [ ]() 或 [ ]:
    // 块：- 1. > --- # ``` 以及 - [ ]
    
    // 行内处理。
    function inlineHandler(line) {
        let inline = [];
        let parent = inline;
        // 以栈数据结构存储等待的字符。单元结构为：[[String, parentObject]]
        let wait = [['', inline]];
        let iter = line[Symbol.iterator]();
        let next = iter.next();
        whileLabel: while (!next.done) {
            switchLabel: switch (next.value) {
                case '*':
                    // 星号可能为斜体或粗体，因此需要检测下一个字符。
                    next = iter.next();
                    if (next.value === '*') {
                        if (wait.at(-1)[0] === '**') {
                            // 如果当前等待 ** ，将当前存储的数组或字符串加入父元素中。
                            if (parent.length === 1) {
                                parent = parent[0];
                            }
                            let current = parent;
                            parent = wait.at(-1)[1];
                            parent.push({
                                type: 'strong',
                                content: current
                            });
                            wait.pop();
                        }
                        else {
                            // 在等待栈中存储等待的字符与当前的父元素。
                            wait.push(['**', parent, 'strong']);
                            // 变更父元素，接收字符。
                            parent = [];
                        }
                        // 前进循环。
                        next = iter.next();
                    }
                    else {
                        if (wait.at(-1)[0] === '*') {
                            if (parent.length === 1) {
                                parent = parent[0];
                            }
                            let current = parent;
                            parent = wait.at(-1)[1];
                            parent.push({
                                type: 'em',
                                content: current
                            })
                            wait.pop();
                        }
                        else {
                            wait.push(['*', parent, 'em']);
                            parent = [];
                        }
                    }
                    break switchLabel;
                case '=':
                    next = iter.next();
                    if (next.value === '=') {
                        if (wait.at(-1)[0] === '==') {
                            if (parent.length === 1) {
                                parent = parent[0];
                            }
                            let current = parent;
                            parent = wait.at(-1)[1];
                            parent.push({
                                type: 'mark',
                                content: current
                            });
                            wait.pop();
                        }
                        else {
                            wait.push(['==', parent, 'mark']);
                            parent = [];
                        }
                        next = iter.next();
                    }
                    else {
                        // 否则，它只是一个普通的等号，执行默认操作。
                        defaultOperation('=');
                    }
                    break switchLabel;
                case '`':
                    // 代码不在等待栈中存储，它不允许嵌套。
                    let code = {
                        type: 'code',
                        content: ''
                    }
                    next = iter.next();
                    findCode: while(next.value !== ('`' || '\n') && !next.done) {
                        code.content += next.value;
                        next = iter.next();
                    }
                    // 终止循环时，next.value === '`'，需要再迭代一次。
                    next = iter.next();
                    parent.push(code);
                    break switchLabel;
                case '[':
                    // 链接不在等待栈中存储，它不允许嵌套。
                    let link = {type: 'link'};
                    // 设置控制变量：是否找到，当前累积的字符串，是否有标题。
                    let found = false, current = '', hasTitle = false;
                    next = iter.next();
                    // 迭代查找链接。
                    findLink: while(!next.done) {
                        if (next.value === '\n') {
                            link.name = current;
                            found = false;
                            break findLink;
                        }
                        if (next.value === ']') {
                            link.name = current;
                            next = iter.next();
                            if (next.value !== '(') {
                                found = false;
                                break findLink;
                            }
                            current = '';
                            next = iter.next();
                            continue findLink;
                        }
                        if (next.value === '"') {
                            found = true;
                            if (hasTitle) {
                                link.title = current;
                                next = iter.next();
                                break findLink;
                            }
                            link.url = current;
                            hasTitle = true;
                            current = '';
                            next = iter.next();
                            continue findLink;
                        }
                        if (next.value === ')') {
                            link.url = current;
                            found = true;
                            break findLink;
                        }
                        current += next.value;
                        next = iter.next();
                    }
                    if (!found) {
                        if (next.done) {
                            link.name = current;
                        }
                        defaultOperation(`[${link.name}]`);
                    }
                    else {
                        parent.push(link);
                        next = iter.next();
                    }
                    break switchLabel;
                case '\\':
                    // 遇到转义符号，迭代一次，执行默认操作。
                    next = iter.next();
                    if (next.value !== '\n') {
                        defaultOperation();
                    }
                    next = iter.next();
                    break switchLabel;
                case '\n':
                    // 遇到换行符时，清理等待栈，添加换行符。
                    while (wait.at(-1)[0] !== '') {
                        if (parent.length === 1) {
                            parent = parent[0];
                        }
                        let current = parent;
                        parent = wait.at(-1)[1];
                        parent.push({
                            type: wait.at(-1)[2],
                            content: current
                        });
                        wait.pop();
                    }
                    inline.push({type: 'br'});
                    parent = inline;
                    next = iter.next();
                    wait = [['', inline]];
                    break switchLabel;
                default:
                    // 将默认操作包装为函数。
                    function defaultOperation(s = next.value) {
                        // 如果上一元素是字符串，拼接它们。
                        if (typeof parent.at(-1) === 'string') {
                            parent[parent.length - 1] += s;
                        }
                        else {
                            parent.push(s);
                        }
                    }
                    defaultOperation();
                    next = iter.next();
                    break switchLabel;
            }
        }
        if (inline.length === 1) {
            inline = inline[0];
        }
        return inline;
    }
    // 块处理，处理过程中，调用行内处理。
    function blockHandler(block, parentBlock) {
        switch (block.at(0)) {
            case '#':
                // 递归迭代，判断是哪一级的标题。通过函数回调是幼稚的做法，应当循环。
                let iter = block[Symbol.iterator]();
                (function findWhichTitle(h = 0) {
                    let next = iter.next();
                    let n = next.value;
                    if (n === ' ') {
                        parentBlock.push({
                            type: `h${h}`,
                            content: inlineHandler(block.slice(h + 1))
                        });
                        return;
                    }
                    if (n === '#' && h < 7) {
                        findWhichTitle(h + 1);
                        return;
                    }
                    parentBlock.push({
                        type: 'p',
                        content: inlineHandler(block)
                    });
                })();
                break;
            case '>':
                block = block.replace(/^> /mg, '');
                let blocks = block.split('\n');
                blocks = blocks.filter(b => b);
                let blockContent = [];
                blocks.forEach(b => blockHandler(b, blockContent));
                if (blockContent.length === 1 && 
                    blockContent[0].type === 'p') {
                    blockContent = blockContent[0].content;
                }
                parentBlock.push({
                    type: 'blockquote',
                    content: blockContent
                });
                break;
            case '-':
                // 这里可能有四种情况：无序列表、待办事项、分割线以及以横杠开头的普通段落。
                if (/^-{3,}$/.test(block)) {
                    parentBlock.push({type: 'hr'});
                    break;
                }
                // 匹配待办事项。
                if (/^- \[.\] /.test(block)) {
                    let childBlocks = block.split('\n');
                    let blockContent = [];
                    childBlocks.forEach(c => {
                        let task = {
                            checked: false,
                            content: inlineHandler(c.slice(6))
                        };
                        if (c.at(3) !== ' ') {
                            task.checked = true;
                        }
                        blockContent.push(task);
                    });
                    parentBlock.push({
                        type: 'todoList',
                        content: blockContent
                    });
                    break;
                }
                // 无序列表中可能有嵌套或缩进。
                if (/^- /.test(block)) {
                    let childBlocks = block.split('\n');
                    let blockContent = [];
                    let iter = childBlocks[Symbol.iterator]();
                    // 进行迭代。
                    intentOrNest: for (let iterNext = iter.next(); !iterNext.done; iterNext = iter.next()) {
                        if (/^\s+/.test(iterNext.value)) {
                            // 如果缩进，查找所有具有相同缩进的行，并对它们进行块处理。
                            let intent = iterNext.value.match(/^\s+/)[0];
                            let newLwsi = [iterNext.value.slice(intent.length)];
                            findNextLwsi: while (!iterNext.done) {
                                iterNext = iter.next();
                                if (/^\s+/.test(iterNext.value)) {
                                    newLwsi.push(
                                        iterNext.value.slice(intent.length));
                                }
                                else {
                                    break findNextLwsi;
                                }
                            }
                            blockHandler(newLwsi.join('\n'), blockContent);
                        }
                        if (iterNext.done) break intentOrNest;
                        // 如果嵌套，对该行进行块处理。
                        if (iterNext.value.at(0) === '-') {
                            blockHandler(iterNext.value.slice(2), blockContent);
                            if (blockContent.at(-1).type === 'p') {
                                blockContent.at(-1).type = 'li';
                            }
                        }
                    }
                    parentBlock.push({
                        type: 'ul',
                        content: blockContent
                    });
                    break;
                }
                parentBlock.push({
                    type: 'p',
                    content: inlineHandler(block)
                });
                break;
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':{
                // 有序列表可能缩进，但不能有嵌套。
                let childBlocks = block.split('\n');
                let blockContent = [];
                let iter = childBlocks[Symbol.iterator]();
                let realOl = false;
                intentOrNest: for(let iterNext = iter.next(); !iterNext.done; iterNext = iter.next()) {
                    // 如果缩进，查找缩进行并处理。
                    if (/^\s+/.test(iterNext.value)) {
                        let intent = iterNext.value.match(/^\s+/)[0];
                        let newLwsi = [iterNext.value.slice(intent.length)];
                        findNextLwsi: while (!iterNext.done) {
                            iterNext = iter.next();
                            if (/^\s+/.test(iterNext.value)) {
                                newLwsi.push(
                                    iterNext.value.slice(intent.length));
                            }
                            else {
                                break findNextLwsi;
                            }
                        }
                        blockHandler(newLwsi.join('\n'), blockContent);
                    }
                    if (iterNext.done) break intentOrNest;
                    // 如果没有缩进，将它们添加到列表中。
                    if (/^\d+\. /.test(iterNext.value)) {
                        realOl = true;
                        blockContent.push({
                            type: 'li',
                            content: inlineHandler(iterNext.value.replace(/^\d+\. /, ''))
                        });
                    }
                }
                if (realOl) {
                    parentBlock.push({
                        type: 'ol',
                        content: blockContent
                    });
                    break;
                }
            }
            default:
                parentBlock.push({
                    type: 'p',
                    content: inlineHandler(block)
                });
                break;
        }
    }
    // 迭代处理块。
    let iterator = blocks[Symbol.iterator]();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
        if (/^`{3}/.test(next.value)) {
            let code = {type: 'code'};
            let childs = next.value.split('\n');
            if (childs[0].at(3)) {
                code.lang = childs[0].slice(3);
            }
            let found = false;
            if (childs.at(-1) === '```') {
                found = true;
                childs.shift();
                childs.pop();
                code.content = childs.join('\n');
            }
            else {
                childs.shift();
                code.content = childs.join('\n') + '\n\n';
            }
            while(!found && !next.done) {
                let next = iterator.next();
                console.log(/`{3}\n?$/.test(next.value));
                if (/`{3}\n?$/.test(next.value)) {
                    found = true;
                    code.content += next.value.slice(0, -3);
                }
                else {
                    code.content += next.value;
                }
            }
            code.content = code.content.replace('"', '\"');
            body.push(code);
            continue;
        }
        blockHandler(next.value, body);
    }
    op.body = body;
    return op;
}

export default mdToJSON;