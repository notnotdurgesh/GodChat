import { ChatSession, MessageNode, Role } from '../types';

export function buildThreadMarkdown(threadPath: MessageNode[], sessionTitle: string): string {
  let md = `# Chat Export: ${sessionTitle}\n\n`;
  md += `*(Exported Current Thread Only)*\n\n---\n\n`;

  for (const node of threadPath) {
    if (node.role === Role.SYSTEM) continue;
    const roleName = node.role === Role.MODEL ? 'Gemini' : 'User';
    md += `### ${roleName}\n\n${node.content || '*[Empty Context]*'}\n\n---\n\n`;
  }
  return md;
}

export function buildAllBranchesMarkdown(session: ChatSession): string {
  let md = `# Chat Export: ${session.title}\n\n`;
  md += `*(Exported Entire Branching Tree)*\n\n`;

  // We maintain a queue of branches to print chronologically.
  const queue: { nodeId: string; branchName: string }[] = [];
  
  if (session.rootNodeId) {
    queue.push({ nodeId: session.rootNodeId, branchName: 'Main Thread' });
  }

  let branchCounter = 0;
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { nodeId, branchName } = queue.shift()!;
    if (visited.has(nodeId)) continue; // avoid cyclic bugs

    md += `\n\n## 🌿 [ ${branchName} ] \n\n`;

    let current: string | null = nodeId;
    while (current) {
      if (visited.has(current)) break;
      const node = session.nodes[current];
      if (!node) break;

      visited.add(current);

      if (node.role !== Role.SYSTEM) {
        const roleName = node.role === Role.MODEL ? 'Gemini' : 'User';
        md += `### ${roleName}\n\n`;
        if (node.thought) {
            md += `<details><summary>Thinking Process</summary>\n\n> ${node.thought.replace(/\n/g, '\n> ')}\n\n</details>\n\n`;
        }
        md += `${node.content || '*[Empty Content]*'}\n\n---\n\n`;
      }

      if (node.childrenIds.length === 0) {
        current = null;
      } else if (node.childrenIds.length === 1) {
        current = node.childrenIds[0];
      } else {
        // Divergence node
        node.childrenIds.forEach((childId) => {
           branchCounter++;
           queue.push({ 
             nodeId: childId, 
             branchName: `Branch ${branchCounter}` 
           });
        });
        current = null; 
      }
    }
  }

  return md;
}

export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.md`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
