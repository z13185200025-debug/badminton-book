#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <signal.h>

@interface BookingApp : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate>
@property NSWindow *window;
@property WKWebView *webView;
@property NSTask *server;
@property NSMutableData *output;
@property NSMutableString *errors;
@property NSURL *localURL;
@property BOOL ready;
@property BOOL quitting;
@end

@implementation BookingApp
- (void)alert:(NSString *)message {
  NSAlert *alert=[NSAlert new];alert.messageText=@"羽毛球预约助手";alert.informativeText=message;
  [alert addButtonWithTitle:@"好"];[alert runModal];
}
- (NSImage *)icon {
  NSImage *image=[[NSImage alloc] initWithSize:NSMakeSize(128,128)];[image lockFocus];
  [[NSColor colorWithRed:.14 green:.365 blue:.26 alpha:1] setFill];
  [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(2,2,124,124) xRadius:28 yRadius:28] fill];
  [[NSColor colorWithRed:.92 green:.95 blue:.83 alpha:1] setStroke];
  NSAffineTransform *transform=[NSAffineTransform transform];[transform translateXBy:76 yBy:78];[transform rotateByDegrees:-38];[transform concat];
  NSBezierPath *oval=[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(-22,-29,44,58)];oval.lineWidth=7;[oval stroke];
  NSBezierPath *shaft=[NSBezierPath bezierPath];[shaft moveToPoint:NSMakePoint(0,-30)];[shaft lineToPoint:NSMakePoint(0,-69)];shaft.lineWidth=8;shaft.lineCapStyle=NSLineCapStyleRound;[shaft stroke];
  NSBezierPath *mesh=[NSBezierPath bezierPath];
  for(int x=-12;x<=12;x+=12){[mesh moveToPoint:NSMakePoint(x,-22)];[mesh lineToPoint:NSMakePoint(x,22)];}
  for(int y=-16;y<=16;y+=16){[mesh moveToPoint:NSMakePoint(-17,y)];[mesh lineToPoint:NSMakePoint(17,y)];}mesh.lineWidth=2;[mesh stroke];
  [image unlockFocus];return image;
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [NSApp setApplicationIconImage:[self icon]];
  NSMenu *menu=[NSMenu new],*appMenu=[NSMenu new],*edit=[NSMenu new];
  NSMenuItem *appItem=[NSMenuItem new];[appItem setSubmenu:appMenu];[menu addItem:appItem];
  [appMenu addItemWithTitle:@"退出羽毛球预约助手" action:@selector(terminate:) keyEquivalent:@"q"];
  NSMenuItem *editItem=[[NSMenuItem alloc] initWithTitle:@"编辑" action:nil keyEquivalent:@""];[editItem setSubmenu:edit];[menu addItem:editItem];
  [edit addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
  [edit addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
  [edit addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
  [edit addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
  [edit addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
  [NSApp setMainMenu:menu];
  NSURL *bundle=[NSBundle mainBundle].bundleURL.URLByResolvingSymlinksInPath;
  NSURL *project=[bundle URLByDeletingLastPathComponent];
  NSURL *launcher=[project URLByAppendingPathComponent:@"tools/run-node.sh"];
  if(![[NSFileManager defaultManager] fileExistsAtPath:launcher.path]){
    [self alert:@"请把应用保留在完整的预约助手文件夹内。可以将应用的替身放到桌面。"];
    [NSApp terminate:nil];return;
  }
  NSRect area=NSScreen.mainScreen.visibleFrame;
  NSRect frame=NSMakeRect(0,0,MIN(1120,area.size.width-70),MIN(950,area.size.height-70));
  self.window=[[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  self.window.title=@"羽毛球预约助手";self.window.minSize=NSMakeSize(780,720);self.window.delegate=self;
  self.window.backgroundColor=[NSColor colorWithRed:.96 green:.965 blue:.94 alpha:1];
  WKWebViewConfiguration *configuration=[WKWebViewConfiguration new];
  self.webView=[[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:configuration];
  self.webView.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;self.webView.navigationDelegate=self;
  [self.window.contentView addSubview:self.webView];[self.window center];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
  self.output=[NSMutableData new];self.errors=[NSMutableString new];self.server=[NSTask new];
  self.server.executableURL=[NSURL fileURLWithPath:@"/bin/zsh"];
  self.server.arguments=@[launcher.path,[[project URLByAppendingPathComponent:@"tools/ui-server.mjs"] path],@"--parent-pid",[NSString stringWithFormat:@"%d",getpid()]];
  self.server.currentDirectoryURL=project;
  NSPipe *output=[NSPipe pipe],*errors=[NSPipe pipe];self.server.standardOutput=output;self.server.standardError=errors;
  __weak BookingApp *weakSelf=self;
  output.fileHandleForReading.readabilityHandler=^(NSFileHandle *handle){NSData *data=handle.availableData;if(!data.length){handle.readabilityHandler=nil;return;}dispatch_async(dispatch_get_main_queue(),^{[weakSelf receive:data];});};
  errors.fileHandleForReading.readabilityHandler=^(NSFileHandle *handle){NSData *data=handle.availableData;if(!data.length){handle.readabilityHandler=nil;return;}NSString *text=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];dispatch_async(dispatch_get_main_queue(),^{if(text&&weakSelf.errors.length<5000)[weakSelf.errors appendString:text];});};
  self.server.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(),^{if(!weakSelf.quitting){[weakSelf alert:weakSelf.errors.length?weakSelf.errors:@"本地服务已结束。请重新打开应用。首次使用需安装 Node.js 22 或更高版本，以及 Google Chrome。"];}if(!weakSelf.ready)[NSApp terminate:nil];});};
  NSError *error=nil;if(![self.server launchAndReturnError:&error]){[self alert:error.localizedDescription];[NSApp terminate:nil];}
}
- (void)receive:(NSData *)data {
  if(self.ready)return;[self.output appendData:data];
  NSString *text=[[NSString alloc] initWithData:self.output encoding:NSUTF8StringEncoding];
  for(NSString *line in [text componentsSeparatedByString:@"\n"]){
    NSDictionary *item=[NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if([item isKindOfClass:NSDictionary.class]&&[item[@"ready"] boolValue]){
      NSURL *url=[NSURL URLWithString:item[@"url"]];
      if(![url.host isEqualToString:@"127.0.0.1"]||![url.scheme isEqualToString:@"http"])continue;
      self.ready=YES;self.localURL=url;[self.webView loadRequest:[NSURLRequest requestWithURL:url]];return;
    }
  }
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
  NSURL *url=action.request.URL;
  BOOL allowed=[url.host isEqualToString:@"127.0.0.1"]&&[url.port isEqual:self.localURL.port];
  handler(allowed?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender{return YES;}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible{[self.window makeKeyAndOrderFront:nil];return YES;}
- (void)applicationWillTerminate:(NSNotification *)notification{self.quitting=YES;if(self.server.running)[self.server terminate];}
@end

int main(int argc,const char *argv[]){@autoreleasepool{NSApplication *app=[NSApplication sharedApplication];BookingApp *delegate=[BookingApp new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app run];}return 0;}
