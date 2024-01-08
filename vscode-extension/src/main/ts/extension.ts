////////////////////////////////////////////////////////////////////////////////
// Copyright 2022 Prominic.NET, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License
//
// Author: Prominic.NET, Inc.
// No warranty of merchantability or fitness of any kind.
// Use this software at your own risk.
////////////////////////////////////////////////////////////////////////////////
import findJava from "./utils/findJava";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  Executable,
} from "vscode-languageclient/node";
import { instrumentOperationAsVsCodeCommand } from "vscode-extension-telemetry-wrapper"

const MISSING_JAVA_ERROR =
  "Could not locate valid JDK. To configure JDK manually, use the groovy.java.home setting.";
const INVALID_JAVA_ERROR =
  "The groovy.java.home setting does not point to a valid JDK.";
const INITIALIZING_MESSAGE = "Initializing Groovy language server...";
const RELOAD_WINDOW_MESSAGE =
  "To apply new settings for Groovy, please reload the window.";
const STARTUP_ERROR = "The Groovy extension failed to start.";
const LABEL_RELOAD_WINDOW = "Reload Window";
let extensionContext: vscode.ExtensionContext | null = null;
let languageClient: LanguageClient | null = null;
let javaPath: string | null = null;
let channel = vscode.window.createOutputChannel('Groovy Client');

function onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
  channel.appendLine('The configuration has changed.');
  if (event.affectsConfiguration("groovy.java.home")) {
    channel.appendLine('The setting "groovy.java.home" has been updated.');
    javaPath = findJava();
    channel.appendLine(`The new java path is now ${javaPath}.`);
    //we're going to try to kill the language server and then restart
    //it with the new settings
    restartLanguageServer();
  }
}

function restartLanguageServer() {
  channel.appendLine('Restarting the Language Server.');
  if (!languageClient) {
    startLanguageServer();
    return;
  }
  let oldLanguageClient = languageClient;
  languageClient = null;
  oldLanguageClient.stop().then(
    () => {
      startLanguageServer();
    },
    () => {
      //something went wrong restarting the language server...
      //this shouldn't happen, but if it does, the user can manually restart
      vscode.window
        .showWarningMessage(RELOAD_WINDOW_MESSAGE, LABEL_RELOAD_WINDOW)
        .then((action) => {
          if (action === LABEL_RELOAD_WINDOW) {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        });
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  channel.appendLine('The extension has been activated.');
  extensionContext = context;
  javaPath = findJava();
  vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration);

  vscode.commands.registerCommand(
    "groovy.restartServer",
    restartLanguageServer
  );

  startLanguageServer();

  context.subscriptions.push(instrumentOperationAsVsCodeCommand("groovy.runGroovyFile", async (uri: vscode.Uri) => {
    await runGroovyFile(uri, true);
  }));
}

export function deactivate() {
  channel.appendLine('The extension is deactivating.');
  extensionContext = null;
}

function runGroovyFile(uri: vscode.Uri, noDebug: boolean) {
  let executeCommand: string = javaPath + ' ';
  let launchConfiguration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("groovy");
  let groovyHomePath: string = launchConfiguration ? (launchConfiguration.home ? launchConfiguration.home : '') : '';
  if (groovyHomePath.length > 0) {
    executeCommand += '-Dgroovy.home=' + groovyHomePath + ' ';
  }
  let groovyProxyHttpHostname: string = launchConfiguration ? (launchConfiguration.http.proxyHost ? launchConfiguration.http.proxyHost : '') : '';
  if (groovyProxyHttpHostname.length > 0) {
    executeCommand += '-Dhttp.proxyHost=' + groovyProxyHttpHostname + ' ';
  }
  let groovyProxyHttpPort: number = launchConfiguration ? (launchConfiguration.http.proxyPort ? launchConfiguration.http.proxyPort : -1) : -1;
  if (groovyProxyHttpPort != -1) {
    executeCommand += '-Dhttp.proxyPort=' + groovyProxyHttpPort + ' ';
  }
  let groovyProxyHttpsHostname: string = launchConfiguration ? (launchConfiguration.https.proxyHost ? launchConfiguration.https.proxyHost : '') : '';;
  if (groovyProxyHttpsHostname.length > 0) {
    executeCommand += '-Dhttps.proxyHost=' + groovyProxyHttpsHostname + ' ';
  }
  let groovyProxyHttpsPort: number = launchConfiguration ? (launchConfiguration.https.proxyPort ? launchConfiguration.https.proxyPort : -1) : -1;
  if (groovyProxyHttpsPort != -1) {
    executeCommand += '-Dhttps.proxyPort=' + groovyProxyHttpsPort + ' ';
  }
  executeCommand += '-Dfile.encoding=UTF-8 ';
  let groovyJarFile: string = launchConfiguration ? (launchConfiguration.jar ? launchConfiguration.jar : '') : '';
  if (groovyJarFile.length > 0) {
    executeCommand += '-classpath ' + groovyJarFile + ' ';
  }
  executeCommand += 'org.codehaus.groovy.tools.GroovyStarter --main groovy.ui.GroovyMain ';
  let classpathsArray: vscode.DebugConfiguration[] = launchConfiguration ? (launchConfiguration.classpath ? launchConfiguration.classpath : []) : [];
  let classpathsString: string = classpathsArray.join(':');
  if (classpathsString.length > 0) {
    executeCommand += '--classpath .:' + classpathsString + ' ';
  }
  // if (vscode.workspace.workspaceFolders !== undefined) {
  //   executeCommand += '--classpath .:' +
  //     vscode.workspace.workspaceFolders[0].uri.path +
  //     '/build/classes ';
  // }
  executeCommand += '--encoding=UTF-8 ' + uri.path;
  let groovyTerminals: vscode.Terminal[] = vscode.window.terminals.filter(terminal => {
    if (terminal.name && terminal.name == 'Groovy') {
      return true
    }
  })
  if (vscode.window.terminals.length == 0 || groovyTerminals.length == 0) {
    groovyTerminals.push(vscode.window.createTerminal('Groovy'));
  }
  if (groovyTerminals.length > 1) {
    for (let i = 1; i < groovyTerminals.length; i++) {
      groovyTerminals[i].sendText("exit");
    }
  }
  groovyTerminals[0].show();
  setTimeout(function () {
    groovyTerminals[0].sendText(executeCommand);
  }, 0.5 * 1000);
}

function startLanguageServer() {
  channel.appendLine('Starting the language server.');
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window },
    (progress) => {
      return new Promise<void>((resolve, reject) => {
        if (!extensionContext) {
          //something very bad happened!
          resolve();
          vscode.window.showErrorMessage(STARTUP_ERROR);
          return;
        }
        if (!javaPath) {
          resolve();
          let settingsJavaHome = vscode.workspace
            .getConfiguration("groovy")
            .get("java.home") as string;
          if (settingsJavaHome) {
            vscode.window.showErrorMessage(INVALID_JAVA_ERROR);
          } else {
            vscode.window.showErrorMessage(MISSING_JAVA_ERROR);
          }
          return;
        }
        progress.report({ message: INITIALIZING_MESSAGE });
        let clientOptions: LanguageClientOptions = {
          documentSelector: [{ scheme: "file", language: "groovy" }],
          synchronize: {
            configurationSection: "groovy",
          },
          uriConverters: {
            code2Protocol: (value: vscode.Uri) => {
              if (/^win32/.test(process.platform)) {
                //drive letters on Windows are encoded with %3A instead of :
                //but Java doesn't treat them the same
                return value.toString().replace("%3A", ":");
              } else {
                return value.toString();
              }
            },
            //this is just the default behavior, but we need to define both
            protocol2Code: (value) => vscode.Uri.parse(value),
          },
        };
        let args = [
          "-jar",
          path.resolve(
            extensionContext.extensionPath,
            "bin",
            "groovy-language-server-all.jar"
          ),
        ];
        //uncomment to allow a debugger to attach to the language server
        //args.unshift("-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005,quiet=y");
        let executable: Executable = {
          command: javaPath,
          args: args,
        };
        languageClient = new LanguageClient(
          "groovy",
          "Groovy Language Server",
          executable,
          clientOptions
        );
        languageClient.onReady().then(resolve, (reason: any) => {
          resolve();
          vscode.window.showErrorMessage(STARTUP_ERROR);
        });
        languageClient.start();
        channel.appendLine('The extension is running.');
      });
    }
  );
}
