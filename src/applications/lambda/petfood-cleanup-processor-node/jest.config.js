module.exports = {
    testEnvironment: 'node',
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    collectCoverageFrom: ['index.js', '!coverage/**', '!node_modules/**', '!test/**'],
    testMatch: ['**/test/**/*.test.js'],
    verbose: true,
    setupFilesAfterEnv: ['<rootDir>/test/setup.js']
};
