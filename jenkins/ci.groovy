node('devops-aws') {
    stage('Clean up') {
        sh 'rm -rf *'
    }

    stage('Checkout') {
        def changeBranch = "change-${GERRIT_CHANGE_NUMBER}-${GERRIT_PATCHSET_NUMBER}"
        def scmVars = checkout scm
        git url: scmVars.GIT_URL
        sh "git fetch origin ${GERRIT_REFSPEC}:${changeBranch}"
        sh "git checkout ${changeBranch}"
    }

    stage('NPM Install') {
        echo 'NPM Install..'
        sh 'npm install'
    }

    stage('NPM Audit') {
        echo 'running npm audit..'
        sh 'npm audit --production'
    }

    stage('Linting check') {
        echo 'running linter...'
        sh 'npm run lint-check'
    }

    stage('Test') {
        echo 'Testing..'
        sh 'npm test'
    }
}
