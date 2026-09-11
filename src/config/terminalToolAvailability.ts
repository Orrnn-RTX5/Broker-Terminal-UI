// These services have no connected implementation in this terminal. Keep every
// entry point locked until the corresponding service/runtime is integrated.
export const unavailableTerminalTools = {
    strategyTester: 'Strategy testing is currently unavailable. A connected strategy testing engine is required.',
    scriptEditor: 'Script editing is currently unavailable. The scripting environment is not connected.',
    agentsManager: 'Agents Manager is currently unavailable. No automation agents are connected.',
    taskManager: 'Task Manager is currently unavailable. No automation runtime is connected.',
    globalVariables: 'Global Variables is currently unavailable. No automation runtime is connected.',
    marketplace: 'RTX5 Marketplace is currently unavailable. The marketplace service is not connected.',
    signalsHub: 'RTX5 Signals Hub is currently unavailable. The signals service is not connected.',
    cloudHosting: 'RTX5 Cloud Hosting is currently unavailable. The hosting service is not connected.',
} as const;

export function lockedTerminalTool(tool: keyof typeof unavailableTerminalTools) {
    return { disabled: true, unavailableReason: unavailableTerminalTools[tool] } as const;
}
